/**
 * Executing and recording a Track 04 evaluation.
 *
 * The benchmark itself is pure — build the dataset, score it, return a report.
 * This layer is what makes a run a fact rather than a printout: it writes the
 * metrics, the versions and the operator to the database, and opens a review
 * row for every record the controller refused to clear.
 *
 * Why persist at all, when the run is deterministic and could be recomputed on
 * demand? Because a score with no history is a claim. A stored series is what
 * turns "the match rate is 100%" into "the match rate has been 100% across
 * these runs, on these dataset and controller versions" — and if it drops, the
 * row tells you whether the data moved, the controller moved, or neither.
 */

import { prisma } from "../prisma";
import { calculateTrialBalance } from "../ledger/trial-balance";
import {
  buildDataset,
  DATASET_SEED,
  DATASET_VERSION,
  type BenchmarkRecord,
  type Split,
} from "./dataset";
import { evaluate, type EvaluationReport, type LedgerCorrectness } from "./evaluate";
import { CONTROLLER_VERSION, processRecord } from "./controller";

export interface RunOptions {
  /** Who pressed the button. "cli" for a terminal run. */
  operator: string;
  /** Which split to report on. Headline runs use HELD_OUT. */
  split?: Split;
  /** Skip writing review rows — used by the CLI, which has no reviewer. */
  openReviewQueue?: boolean;
}

export interface RecordedRun {
  runId: string;
  report: EvaluationReport;
  ledger: LedgerCorrectness;
  reviewsOpened: number;
}

/** Read the live trial balance, so "ledger imbalance" is a measured figure. */
export async function readLedgerCorrectness(): Promise<LedgerCorrectness> {
  const tb = await calculateTrialBalance();
  return {
    balanced: tb.balanced,
    imbalancePaise: Math.abs(tb.net),
    totalDebitsPaise: tb.totalDebits,
    totalCreditsPaise: tb.totalCredits,
    accountCount: tb.accounts.length,
    measuredAgainst: "LIVE_LEDGER",
  };
}

/**
 * Run the benchmark and record it.
 *
 * The review queue is rebuilt per run rather than carried forward. An
 * exception belongs to the run that raised it: the dataset is deterministic,
 * so the same record escalates every time, and letting a decision from one run
 * silently close an exception in the next would mean an operator's judgement
 * about one version of the controller was being applied to another.
 */
export async function runAndRecord(
  options: RunOptions
): Promise<RecordedRun> {
  const { operator, split = "HELD_OUT", openReviewQueue = true } = options;

  const all = buildDataset(DATASET_SEED);
  const records: BenchmarkRecord[] = all.filter((r) => r.split === split);

  const report = evaluate(records, {
    datasetVersion: DATASET_VERSION,
    datasetSeed: DATASET_SEED,
    split,
  });

  const ledger = await readLedgerCorrectness();

  const runId = `run_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  /*
   * The run row and its review rows are written together or not at all.
   *
   * They were two separate writes, and a failure between them left a run
   * claiming 140 exceptions with none stored - a row that misreports its own
   * contents, which is worse than no row. The exception count and the
   * exceptions are the same fact recorded twice; they must commit together.
   */
  await prisma.$transaction(async (tx) => {
    await tx.benchmarkRun.create({
    data: {
      id: runId,
      operator,
      datasetVersion: report.datasetVersion,
      datasetSeed: report.datasetSeed,
      controllerVersion: CONTROLLER_VERSION,
      split,
      recordsProcessed: report.recordsProcessed,
      elapsedMs: report.elapsedMs,
      recordsPerSecond: report.recordsPerSecond,
      correctlyResolved: report.correctlyResolved,
      matchRate: report.matchRate,
      autoResolutionRate: report.autoResolutionRate,
      exceptionRate: report.exceptionRate,
      autoResolutionPrecision: report.autoResolutionPrecision,
      falseResolutions: report.falseResolutions,
      missedMatches: report.missedMatches,
      wrongExceptionTypes: report.wrongExceptionTypes,
      valueReconciledPaise: BigInt(report.valueReconciledPaise),
      valueHeldForReviewPaise: BigInt(report.valueHeldForReviewPaise),
      valueExposedPaise: BigInt(report.valueExposedByUnresolvedPaise),
      valueAtRiskPaise: BigInt(report.valueAtRiskFromFalseResolutionsPaise),
      duplicatePaymentsPrevented: report.duplicatePaymentsPrevented,
      exceptionCount: report.exceptions.length,
      ledgerBalanced: ledger.balanced,
      ledgerImbalancePaise: BigInt(ledger.imbalancePaise),
    },
    });

    if (openReviewQueue && report.exceptions.length > 0) {
      await tx.exceptionReview.createMany({
        data: report.exceptions.map((e) => ({
          id: `rev_${runId}_${e.recordId}`,
          runId,
          recordId: e.recordId,
          exceptionType: e.exceptionType,
          amountPaise: e.amountPaise,
          supplierName: e.supplierName,
          confidence: e.confidence,
          reason: e.reason,
          recommendedAction: e.recommendedAction,
          whyNotAutoResolved: e.whyNotAutoResolved,
          difficulty: e.difficulty,
          status: "OPEN",
        })),
      });
    }
  });

  const reviewsOpened = openReviewQueue ? report.exceptions.length : 0;

  return { runId, report, ledger, reviewsOpened };
}

/** The decisions a human may record against an escalated record. */
export const REVIEW_ACTIONS = {
  ACCEPTED: {
    label: "Accept the suggested match",
    requiresNote: false,
    description:
      "The controller's candidate was right after all. Clearing it here records that a person looked, which is the difference between this and the controller having cleared it itself.",
  },
  REJECTED: {
    label: "Reject the match",
    requiresNote: true,
    description:
      "The candidate is not this payment. A reason is mandatory - a rejection with no stated cause tells the next reviewer nothing.",
  },
  RELINKED: {
    label: "Link a different record",
    requiresNote: true,
    description:
      "The correct settlement is a different row. Record which one, so the link is auditable rather than implied.",
  },
  MARKED_DUPLICATE: {
    label: "Mark as a duplicate payment",
    requiresNote: true,
    description:
      "Confirms money left twice. This is a recall, not a bookkeeping correction.",
  },
  FROZEN: {
    label: "Freeze the transaction",
    requiresNote: true,
    description:
      "Stop anything further moving on this record until it is understood. Used when the exception may indicate a live problem rather than a stale one.",
  },
} as const;

export type ReviewAction = keyof typeof REVIEW_ACTIONS;

export interface ReviewInput {
  reviewId: string;
  action: ReviewAction;
  reviewerId: string;
  note?: string;
  linkedExternalId?: string;
}

/**
 * Record a human decision on one exception.
 *
 * Notes are mandatory for every action except plain acceptance. An exception
 * closed with no stated reason is indistinguishable from an exception nobody
 * looked at, and the whole point of escalating was to get a judgement on the
 * record.
 */
export async function recordReview(input: ReviewInput) {
  const spec = REVIEW_ACTIONS[input.action];
  if (!spec) {
    throw new Error(`Unknown review action: ${input.action}`);
  }

  const note = input.note?.trim() ?? "";
  if (spec.requiresNote && note.length === 0) {
    throw new Error(
      `${input.action} requires a note. Closing an exception without stating ` +
        "why leaves no record of the judgement that was made."
    );
  }

  if (input.action === "RELINKED" && !input.linkedExternalId) {
    throw new Error(
      "Relinking requires the external record id being linked instead."
    );
  }

  const existing = await prisma.exceptionReview.findUnique({
    where: { id: input.reviewId },
  });
  if (!existing) {
    throw new Error(`No exception review with id ${input.reviewId}`);
  }
  if (existing.status !== "OPEN") {
    throw new Error(
      `${input.reviewId} was already resolved as ${existing.status}. Reopen it ` +
        "explicitly rather than overwriting a recorded judgement."
    );
  }

  return prisma.exceptionReview.update({
    where: { id: input.reviewId },
    data: {
      status: input.action,
      reviewerId: input.reviewerId,
      reviewNote: note || null,
      linkedExternalId: input.linkedExternalId ?? null,
      reviewedAt: new Date(),
    },
  });
}

/** Reopen a resolved exception, so a mistaken close is correctable. */
export async function reopenReview(reviewId: string, reviewerId: string) {
  return prisma.exceptionReview.update({
    where: { id: reviewId },
    data: {
      status: "OPEN",
      reviewerId,
      reviewedAt: null,
    },
  });
}

/** Full evidence for one escalated record, rebuilt from the dataset. */
export function evidenceFor(recordId: string) {
  const record = buildDataset(DATASET_SEED).find(
    (r) => r.recordId === recordId
  );
  if (!record) return null;
  return {
    record,
    decision: processRecord(record),
  };
}
