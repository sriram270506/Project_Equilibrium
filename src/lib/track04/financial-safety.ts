/**
 * Financial safety counters.
 *
 * These are the numbers that matter more than any accuracy chart. An accuracy
 * figure says how often the system was right; these say what happened the
 * times it was not, and every one of them is a count of a specific way money
 * or the books could have been damaged.
 *
 * They are deliberately sourced from different places. Two come from the
 * benchmark, three from the live system. A safety panel computed entirely from
 * the benchmark would be a panel about a simulation — and a "zero unbalanced
 * journals" that never touched a ledger is not a claim, it is decoration.
 *
 * Each counter records HOW it was measured, so a reviewer can tell which are
 * observations about running code and which are results from a scored dataset.
 */

import { prisma } from "../prisma";
import { calculateTrialBalance } from "../ledger/trial-balance";
import { buildDataset, DATASET_SEED, DATASET_VERSION } from "./dataset";
import { evaluate } from "./evaluate";

export type SafetySource = "BENCHMARK" | "LIVE_SYSTEM";

export interface SafetyCounter {
  key: string;
  label: string;
  /** How many times this went wrong. Zero is the only acceptable value. */
  count: number;
  /** Rupee value at stake, where the counter has one. */
  valuePaise: number | null;
  source: SafetySource;
  /** What was actually checked, in one line a reviewer can verify. */
  measurement: string;
  /** What it would mean if this were not zero. */
  consequence: string;
}

export interface FinancialSafetyReport {
  counters: SafetyCounter[];
  allClear: boolean;
  datasetVersion: string;
  measuredAt: string;
}

/**
 * Count every way this system could have damaged money or the books.
 *
 * Note what is NOT here: a match rate, a confidence, an AUC. Those describe
 * performance. These describe harm.
 */
export async function financialSafety(): Promise<FinancialSafetyReport> {
  const heldOut = buildDataset(DATASET_SEED).filter(
    (r) => r.split === "HELD_OUT"
  );
  const report = evaluate(heldOut, {
    datasetVersion: DATASET_VERSION,
    datasetSeed: DATASET_SEED,
    split: "HELD_OUT",
  });

  const trialBalance = await calculateTrialBalance();

  /*
   * Journals that do not foot.
   *
   * Counted per transaction rather than as one aggregate, because a ledger can
   * balance overall while individual journals are broken in offsetting ways -
   * and the aggregate would report that as healthy.
   */
  const transactions = await prisma.ledgerTransaction.findMany({
    include: { entries: true },
  });
  const unbalancedJournals = transactions.filter((txn) => {
    const debits = txn.entries.reduce((s, e) => s + e.debitPaise, 0);
    const credits = txn.entries.reduce((s, e) => s + e.creditPaise, 0);
    return debits !== credits;
  });

  /*
   * Maker-checker violations: a payment above the dual-approval threshold
   * where the same person raised and confirmed it. The service refuses this,
   * so a non-zero count means something wrote to the database around the
   * service - which is the case worth being able to detect.
   */
  const selfApproved = await prisma.paymentIntent.findMany({
    where: {
      checkerId: { not: null },
      approvalThresholdPaise: { not: null },
    },
    select: { id: true, makerId: true, checkerId: true, amountPaise: true },
  });
  const unauthorisedApprovals = selfApproved.filter(
    (p) => p.makerId !== null && p.makerId === p.checkerId
  );

  /*
   * Exceptions closed with no stated reason.
   *
   * An exception resolved by an override - anything other than plain agreement
   * with the controller - must carry a note. One that does not is
   * indistinguishable from an exception nobody looked at, and the whole point
   * of escalating was to obtain a judgement on the record.
   */
  const silentCloses = await prisma.exceptionReview.count({
    where: {
      status: { notIn: ["OPEN", "ACCEPTED"] },
      OR: [{ reviewNote: null }, { reviewNote: "" }],
    },
  });

  const counters: SafetyCounter[] = [
    {
      key: "falseResolutions",
      label: "False resolutions",
      count: report.falseResolutions,
      valuePaise: report.valueAtRiskFromFalseResolutionsPaise,
      source: "BENCHMARK",
      measurement: `Records cleared without a human that the ground truth says needed one, across ${report.recordsProcessed} held-out records.`,
      consequence:
        "Each one closes the book on a payment defect. Nobody looks at a reconciled record again.",
    },
    {
      key: "duplicatePayments",
      label: "Duplicate payments let through",
      count:
        report.byLabel.find((b) => b.key === "DUPLICATE")
          ? (report.byLabel.find((b) => b.key === "DUPLICATE")!.total -
            report.byLabel.find((b) => b.key === "DUPLICATE")!.correct)
          : 0,
      valuePaise: null,
      source: "BENCHMARK",
      measurement: `Planted double-settlements the controller failed to catch (${report.duplicatePaymentsPrevented} caught).`,
      consequence:
        "The money has already left the account twice. Recovery depends on the counterparty returning it voluntarily.",
    },
    {
      key: "unbalancedJournals",
      label: "Unbalanced journals",
      count: unbalancedJournals.length,
      valuePaise: Math.abs(trialBalance.net),
      source: "LIVE_SYSTEM",
      /*
       * Say so when there is nothing to check.
       *
       * On an empty database this read "every one of 0 ledger transactions
       * checked" beside a green zero — a counter that cannot fail, presented
       * as a passing result. That is the exact failure this panel exists to
       * avoid, and it would have been the most misleading line on the page.
       */
      measurement:
        transactions.length === 0
          ? "No journals have been posted yet, so this has not been tested. Seed the demo or approve a payment to give it something to check."
          : `Every one of ${transactions.length} ledger transactions checked leg by leg, not just the aggregate trial balance.`,
      consequence:
        "The books do not foot. Every figure derived from them is unreliable until it is found.",
    },
    {
      key: "silentExceptionCloses",
      label: "Exceptions closed with no reason",
      count: silentCloses,
      valuePaise: null,
      source: "LIVE_SYSTEM",
      measurement:
        "Reviews resolved by an override (reject, relink, duplicate, freeze) that carry no note.",
      consequence:
        "An exception closed without a stated reason cannot be told apart from one nobody looked at.",
    },
    {
      key: "unauthorisedApprovals",
      label: "Self-approved large payments",
      count: unauthorisedApprovals.length,
      valuePaise: unauthorisedApprovals.reduce(
        (s, p) => s + p.amountPaise,
        0
      ),
      source: "LIVE_SYSTEM",
      measurement:
        "Payments above the dual-approval threshold where the maker and the checker are the same person.",
      consequence:
        "Maker-checker was bypassed. The service refuses this, so a non-zero count means a write went around the service.",
    },
  ];

  return {
    counters,
    allClear: counters.every((c) => c.count === 0),
    datasetVersion: DATASET_VERSION,
    measuredAt: new Date().toISOString(),
  };
}
