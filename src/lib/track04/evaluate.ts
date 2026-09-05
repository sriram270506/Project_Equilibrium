/**
 * Scoring the finance-operations controller.
 *
 * These are OPERATIONAL metrics and they are deliberately kept apart from the
 * liquidity model's AUC and precision. The two answer different questions:
 * the model asks "will this supplier run short", the controller asks "do these
 * two records describe the same payment, and is it safe to act on that
 * unsupervised". Reporting an AUC as though it were reconciliation accuracy
 * would be a category error, and a finance reviewer would spot it instantly.
 *
 * The metric that matters most here is not the match rate. It is the FALSE
 * RESOLUTION rate: records the controller cleared that it should have
 * escalated. A missed match costs an operator five minutes. A false resolution
 * closes the book on a duplicate payment or a short settlement, and nobody
 * looks at it again.
 */

import {
  processRecord,
  processRecordBaseline,
  expectedExceptionFor,
  type ControllerDecision,
  type ExceptionType,
} from "./controller";
import {
  type BenchmarkRecord,
  type Difficulty,
  type GroundTruthLabel,
  type Split,
} from "./dataset";

export interface RecordResult {
  record: BenchmarkRecord;
  decision: ControllerDecision;
  /** Did the controller do the right thing, by both action and reason? */
  correct: boolean;
  /** Cleared something that needed a human. The expensive error. */
  falseResolution: boolean;
  /** Escalated something that was safe to clear. The cheap error. */
  missedMatch: boolean;
  /** Escalated correctly, but named the wrong cause. */
  wrongExceptionType: boolean;
}

export interface ExceptionRow {
  recordId: string;
  exceptionType: ExceptionType;
  amountPaise: number;
  supplierName: string;
  confidence: number;
  reason: string;
  recommendedAction: string;
  whyNotAutoResolved: string;
  status: "OPEN";
  difficulty: Difficulty;
}

export interface Breakdown {
  key: string;
  total: number;
  correct: number;
  accuracy: number;
  falseResolutions: number;
}

export interface EvaluationReport {
  /* Provenance — everything needed to reproduce this exact number. */
  datasetVersion: string;
  datasetSeed: number;
  controllerVersion: string;
  split: Split | "ALL";
  runAt: string;

  /* Volume and speed. */
  recordsProcessed: number;
  elapsedMs: number;
  recordsPerSecond: number;
  averageMsPerRecord: number;

  /* Operational accuracy. */
  correctlyResolved: number;
  matchRate: number;
  autoResolutionRate: number;
  exceptionRate: number;

  /* Error decomposition. */
  falseResolutions: number;
  falseResolutionRate: number;
  missedMatches: number;
  wrongExceptionTypes: number;

  /* Financial materiality. */
  valueReconciledPaise: number;
  valueHeldForReviewPaise: number;
  valueExposedByUnresolvedPaise: number;
  valueAtRiskFromFalseResolutionsPaise: number;

  /* Financial safety. */
  duplicatePaymentsPrevented: number;
  shortSettlementsCaught: number;
  unexplainedOutboundCaught: number;
  silentResolutionsOfBadRecords: number;

  /* Breakdowns. */
  byDifficulty: Breakdown[];
  byLabel: Breakdown[];

  /* Honest exception list. */
  exceptions: ExceptionRow[];
}

function isCorrect(
  record: BenchmarkRecord,
  decision: ControllerDecision
): { correct: boolean; wrongType: boolean } {
  const expectedAction = record.groundTruth.expectedAction;
  const cleared = decision.outcome === "AUTO_RESOLVED";

  if (expectedAction === "AUTO_RESOLVE") {
    // Right only if it cleared, against the right external record.
    return {
      correct:
        cleared &&
        decision.matchedExternalId ===
          record.groundTruth.expectedMatchExternalId,
      wrongType: false,
    };
  }

  // Should have escalated. Escalating for the wrong reason is a partial
  // success: the money is safe, but the operator is sent down the wrong path.
  if (cleared) return { correct: false, wrongType: false };

  const expectedType = expectedExceptionFor(record.groundTruth.label);
  const wrongType = decision.exceptionType !== expectedType;
  return { correct: !wrongType, wrongType };
}

function breakdown<K extends string>(
  results: RecordResult[],
  pick: (r: RecordResult) => K
): Breakdown[] {
  const groups = new Map<string, RecordResult[]>();
  for (const r of results) {
    const key = pick(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return [...groups.entries()]
    .map(([key, rows]) => ({
      key,
      total: rows.length,
      correct: rows.filter((r) => r.correct).length,
      accuracy: rows.filter((r) => r.correct).length / rows.length,
      falseResolutions: rows.filter((r) => r.falseResolution).length,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Run the controller over a set of records and score it.
 *
 * Timing wraps only the controller call, not dataset construction or report
 * assembly, so the throughput figure describes the thing being measured.
 */
export function evaluate(
  records: BenchmarkRecord[],
  options: {
    datasetVersion: string;
    datasetSeed: number;
    split: Split | "ALL";
    useBaseline?: boolean;
  }
): EvaluationReport {
  const run = options.useBaseline ? processRecordBaseline : processRecord;

  const decisions: ControllerDecision[] = new Array(records.length);
  const started = process.hrtime.bigint();
  for (let i = 0; i < records.length; i++) {
    decisions[i] = run(records[i]);
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const results: RecordResult[] = records.map((record, i) => {
    const decision = decisions[i];
    const { correct, wrongType } = isCorrect(record, decision);
    const shouldEscalate = record.groundTruth.expectedAction === "ESCALATE";
    const cleared = decision.outcome === "AUTO_RESOLVED";

    return {
      record,
      decision,
      correct,
      falseResolution: shouldEscalate && cleared,
      missedMatch: !shouldEscalate && !cleared,
      wrongExceptionType: wrongType,
    };
  });

  const autoResolved = results.filter(
    (r) => r.decision.outcome === "AUTO_RESOLVED"
  );
  const escalated = results.filter(
    (r) => r.decision.outcome !== "AUTO_RESOLVED"
  );
  const falseResolutions = results.filter((r) => r.falseResolution);

  const exceptions: ExceptionRow[] = escalated
    .map((r) => ({
      recordId: r.record.recordId,
      exceptionType: r.decision.exceptionType ?? "LOW_CONFIDENCE",
      amountPaise: r.decision.amountPaise,
      supplierName:
        r.record.internal?.supplierName ?? "(no internal record)",
      confidence: r.decision.confidence,
      reason: r.decision.reason,
      recommendedAction: r.decision.recommendedAction,
      whyNotAutoResolved: r.decision.whyNotAutoResolved,
      status: "OPEN" as const,
      difficulty: r.record.difficulty,
    }))
    .sort((a, b) => b.amountPaise - a.amountPaise);

  const countCaught = (label: GroundTruthLabel) =>
    results.filter(
      (r) => r.record.groundTruth.label === label && r.correct
    ).length;

  const correctlyResolved = results.filter((r) => r.correct).length;

  return {
    datasetVersion: options.datasetVersion,
    datasetSeed: options.datasetSeed,
    controllerVersion: decisions[0]?.controllerVersion ?? "unknown",
    split: options.split,
    runAt: new Date().toISOString(),

    recordsProcessed: records.length,
    elapsedMs,
    recordsPerSecond: records.length / (elapsedMs / 1000),
    averageMsPerRecord: elapsedMs / records.length,

    correctlyResolved,
    matchRate: correctlyResolved / records.length,
    autoResolutionRate: autoResolved.length / records.length,
    exceptionRate: escalated.length / records.length,

    falseResolutions: falseResolutions.length,
    falseResolutionRate: falseResolutions.length / records.length,
    missedMatches: results.filter((r) => r.missedMatch).length,
    wrongExceptionTypes: results.filter((r) => r.wrongExceptionType).length,

    valueReconciledPaise: autoResolved.reduce(
      (s, r) => s + r.decision.amountPaise,
      0
    ),
    valueHeldForReviewPaise: escalated.reduce(
      (s, r) => s + r.decision.amountPaise,
      0
    ),
    valueExposedByUnresolvedPaise: escalated.reduce(
      (s, r) => s + r.record.groundTruth.materialityPaise,
      0
    ),
    valueAtRiskFromFalseResolutionsPaise: falseResolutions.reduce(
      (s, r) => s + r.record.groundTruth.materialityPaise,
      0
    ),

    duplicatePaymentsPrevented: countCaught("DUPLICATE"),
    shortSettlementsCaught: countCaught("AMOUNT_MISMATCH"),
    unexplainedOutboundCaught: countCaught("MISSING_INTERNAL"),
    silentResolutionsOfBadRecords: falseResolutions.length,

    byDifficulty: breakdown(results, (r) => r.record.difficulty),
    byLabel: breakdown(results, (r) => r.record.groundTruth.label),

    exceptions,
  };
}
