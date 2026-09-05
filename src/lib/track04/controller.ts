/**
 * The finance-operations controller.
 *
 * One pass over one reconciliation subject:
 *
 *   ingest -> normalise -> generate candidates -> score -> policy -> outcome
 *
 * The important property is that SCORING and DECIDING are separate, and the
 * policy can veto a high-confidence match. A scorer alone would happily
 * auto-resolve a duplicate payment: both rows match the instruction perfectly,
 * which is exactly what makes it a duplicate. Confidence answers "do these
 * records refer to the same event"; policy answers "is it safe to act on that
 * without a human", and those are different questions.
 *
 * Each stage declares what KIND of computation it is:
 *
 *   DETERMINISTIC — fixed rules; identical input gives identical output, and
 *                   the reasoning is fully inspectable.
 *   STATISTICAL   — weighted field agreement producing a confidence. Tuned on
 *                   the tuning split only.
 *   POLICY        — deterministic gates that can override the score.
 *
 * There is no LLM anywhere in this path. Calling a weighted-sum matcher "AI"
 * would be the kind of claim this project exists to avoid; what makes it worth
 * showing is that it abstains, prices its own errors, and is measured on
 * held-out data.
 */

import type {
  BenchmarkRecord,
  ExternalRecord,
  GroundTruthLabel,
  InternalRecord,
} from "./dataset";

export const CONTROLLER_VERSION = "track04-controller-1.0.0";

export type StageKind = "DETERMINISTIC" | "STATISTICAL" | "POLICY";

/** What the controller decided to do. Abstention is a first-class outcome. */
export type Outcome =
  | "AUTO_RESOLVED"
  | "NEEDS_REVIEW"
  | "UNMATCHED"
  | "REJECTED";

/** Why a record was escalated. Mirrors the ground-truth taxonomy. */
export type ExceptionType =
  | "AMOUNT_MISMATCH"
  | "STATUS_MISMATCH"
  | "MISSING_EXTERNAL"
  | "MISSING_INTERNAL"
  | "DUPLICATE"
  | "TAX_MISMATCH"
  | "INVALID_REFERENCE"
  | "AMBIGUOUS"
  | "COUNTERPARTY_MISMATCH"
  | "PARTIAL_SETTLEMENT"
  | "LOW_CONFIDENCE";

export interface FieldComparison {
  field: string;
  internalValue: string;
  externalValue: string;
  agreed: boolean;
  /** Contribution to the confidence score, in points. */
  weight: number;
  note?: string;
}

export interface CandidateScore {
  externalId: string;
  confidence: number;
  comparisons: FieldComparison[];
}

export interface StageTrace {
  stage: string;
  kind: StageKind;
  detail: string;
}

export interface ControllerDecision {
  recordId: string;
  outcome: Outcome;
  matchedExternalId: string | null;
  confidence: number;
  exceptionType: ExceptionType | null;
  /** One line an operator can read and act on. */
  reason: string;
  /** What a human should do next. Empty when auto-resolved. */
  recommendedAction: string;
  /** Why this could not be resolved automatically. Empty when it was. */
  whyNotAutoResolved: string;
  amountPaise: number;
  comparisons: FieldComparison[];
  trace: StageTrace[];
  controllerVersion: string;
}

/* ------------------------------------------------------------- Thresholds */

/**
 * Tuned against the TUNING split only. See scripts/track04-benchmark.ts, which
 * refuses to report headline numbers on anything but HELD_OUT.
 */
export const THRESHOLDS = {
  /** Minimum confidence to clear a record without a human. */
  autoResolve: 0.9,
  /** Below this, there is no credible candidate at all. */
  candidateFloor: 0.45,
  /**
   * Two candidates within this distance of each other are not distinguishable
   * by the evidence, however high the leader scores.
   */
  ambiguityMargin: 0.08,
  /**
   * Paise of amount difference tolerated as a genuine match. Zero, on purpose:
   * a payment that settled for a different amount is a different payment. A
   * "small" tolerance is how short-settlements get auto-cleared at volume.
   */
  amountTolerancePaise: 0,
  /** Days between value dates still considered the same settlement. */
  valueDateToleranceDays: 3,
} as const;

/* ------------------------------------------------------- Stage 1: normalise */

/**
 * DETERMINISTIC. Strip the cosmetic differences an intermediary bank file
 * introduces — case, separators, padding, the provider's own prefix — without
 * touching anything semantic.
 */
export function normaliseReference(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^RZP[\/\-]/, "")
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Strings a bank file uses to mean "there is no reference here".
 *
 * A maintained denylist, and therefore inherently incomplete — a provider can
 * invent a new placeholder tomorrow. It is a denylist rather than a pattern
 * because the failure mode of guessing is asymmetric: treating a real
 * reference as a placeholder loses a match, and both errors surface as
 * exceptions rather than as wrong auto-resolutions.
 */
const REFERENCE_PLACEHOLDERS = new Set([
  "",
  "NARRATIONUNAVAILABLE",
  "NA",
  "NIL",
  "NONE",
  "UNAVAILABLE",
  "NOTAVAILABLE",
  "NOREFERENCE",
]);

/** DETERMINISTIC. Does this string actually identify anything? */
export function isUsableReference(raw: string): boolean {
  const normalised = normaliseReference(raw);
  return normalised.length > 0 && !REFERENCE_PLACEHOLDERS.has(normalised);
}

/** DETERMINISTIC. Company names differ cosmetically across systems. */
export function normaliseParty(raw: string): string {
  return (
    raw
      .toUpperCase()
      /*
       * Suffixes are stripped as whole words, BEFORE punctuation is removed,
       * so the word boundaries still have something to anchor against. Without
       * them "CO" matches inside "COROMANDEL" and two unrelated companies
       * normalise to the same string - which, in the one function whose job is
       * deciding whether the right party was paid, would turn a safety check
       * into a source of false matches.
       */
      .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CORP|CO)\b/g, "")
      .replace(/[^A-Z0-9]/g, "")
  );
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round((Date.parse(a) - Date.parse(b)) / 86400000)
  );
}

/* ------------------------------------------------- Stage 2-3: score a pair */

/**
 * STATISTICAL. Weighted field agreement, normalised to 0-1.
 *
 * Weights are ordered by how hard each field is to agree on by coincidence. A
 * UTR is a bank-assigned unique identifier, so agreement is near-conclusive.
 * An amount agreeing to the paise is strong. A date agreeing is weak — half
 * the file shares a date.
 */
export function scoreCandidate(
  internal: InternalRecord,
  external: ExternalRecord
): CandidateScore {
  const comparisons: FieldComparison[] = [];

  const internalRef = normaliseReference(internal.reference);
  const externalRef = normaliseReference(external.reference);
  const refAgreed =
    isUsableReference(internal.reference) &&
    isUsableReference(external.reference) &&
    internalRef === externalRef;
  comparisons.push({
    field: "reference",
    internalValue: internal.reference,
    externalValue: external.reference || "(empty)",
    agreed: refAgreed,
    weight: 35,
    note: refAgreed && internal.reference !== external.reference
      ? "Matched after normalising case and separators"
      : undefined,
  });

  const utrAgreed =
    internal.utr !== null && external.utr !== null && internal.utr === external.utr;
  comparisons.push({
    field: "utr",
    internalValue: internal.utr ?? "(none)",
    externalValue: external.utr ?? "(none)",
    agreed: utrAgreed,
    weight: 30,
    note:
      external.utr === null
        ? "Provider row carries no bank reference"
        : undefined,
  });

  const amountAgreed =
    Math.abs(internal.amountPaise - external.amountPaise) <=
    THRESHOLDS.amountTolerancePaise;
  comparisons.push({
    field: "amount",
    internalValue: String(internal.amountPaise),
    externalValue: String(external.amountPaise),
    agreed: amountAgreed,
    weight: 25,
    note: amountAgreed
      ? undefined
      : `Differs by ${Math.abs(internal.amountPaise - external.amountPaise)} paise`,
  });

  const dateAgreed =
    daysBetween(internal.valueDate, external.valueDate) <=
    THRESHOLDS.valueDateToleranceDays;
  comparisons.push({
    field: "valueDate",
    internalValue: internal.valueDate,
    externalValue: external.valueDate,
    agreed: dateAgreed,
    weight: 10,
  });

  /*
   * Who actually received the money.
   *
   * This comparison did not exist in the first version, and the benchmark
   * found the hole: ten records where the reference, amount, date and bank
   * identifier all agreed but the provider had paid a different company were
   * auto-resolved at 100% confidence. Every field the matcher looked at said
   * the record was correct. It was not looking at the only field that mattered.
   */
  const beneficiaryAgreed =
    normaliseParty(internal.supplierName) ===
    normaliseParty(external.beneficiaryName);
  comparisons.push({
    field: "beneficiary",
    internalValue: internal.supplierName,
    externalValue: external.beneficiaryName,
    agreed: beneficiaryAgreed,
    weight: 20,
    note: beneficiaryAgreed ? undefined : "Money went to a different party",
  });

  const earned = comparisons.reduce(
    (s, c) => s + (c.agreed ? c.weight : 0),
    0
  );
  const total = comparisons.reduce((s, c) => s + c.weight, 0);

  return {
    externalId: external.id,
    confidence: earned / total,
    comparisons,
  };
}

/* ------------------------------------------------------------ The pipeline */

function escalate(
  record: BenchmarkRecord,
  exceptionType: ExceptionType,
  reason: string,
  recommendedAction: string,
  whyNotAutoResolved: string,
  confidence: number,
  comparisons: FieldComparison[],
  trace: StageTrace[],
  outcome: Outcome = "NEEDS_REVIEW"
): ControllerDecision {
  return {
    recordId: record.recordId,
    outcome,
    matchedExternalId: null,
    confidence,
    exceptionType,
    reason,
    recommendedAction,
    whyNotAutoResolved,
    amountPaise:
      record.internal?.amountPaise ?? record.externals[0]?.amountPaise ?? 0,
    comparisons,
    trace,
    controllerVersion: CONTROLLER_VERSION,
  };
}

/**
 * Run one record end to end.
 *
 * Ordering is deliberate. Structural checks (nothing on one side, two rows on
 * the other) run BEFORE scoring, because scoring a duplicate produces two
 * perfect matches and a naive pipeline would resolve against the first.
 */
export function processRecord(record: BenchmarkRecord): ControllerDecision {
  const trace: StageTrace[] = [];
  const { internal, externals } = record;

  trace.push({
    stage: "ingest",
    kind: "DETERMINISTIC",
    detail: `1 internal record, ${externals.length} external record(s)`,
  });

  /* --- Structural: one side missing --------------------------------- */

  if (internal === null) {
    return escalate(
      record,
      "MISSING_INTERNAL",
      "The provider settled money we hold no instruction for.",
      "Trace the provider reference to an instruction. If none exists, treat as unexplained outbound cash and freeze the counterparty.",
      "There is no internal record to match against, so there is nothing to be confident about. Auto-resolving would mean accepting the provider's word that a payment we never authorised was correct.",
      0,
      [],
      trace,
      "UNMATCHED"
    );
  }

  if (externals.length === 0) {
    return escalate(
      record,
      "MISSING_EXTERNAL",
      "We recorded a payment the provider has no record of.",
      "Query the provider by internal reference before re-sending. Re-instructing without confirming is how a single payment becomes two.",
      "No candidate exists. The instruction may not have left, or the settlement file may be incomplete — those need different responses and the data cannot tell them apart.",
      0,
      [],
      trace,
      "UNMATCHED"
    );
  }

  /* --- Structural: nothing that identifies the row ------------------- */

  /*
   * A settlement row with neither a usable reference nor a bank identifier
   * cannot be linked to anything, however well the amount happens to line up.
   * This is a structural fact, so it is decided here rather than by falling
   * through the confidence floor — which is what it used to do, and which made
   * the classification depend on the arithmetic of unrelated field weights.
   */
  const identifiable = externals.filter(
    (e) => isUsableReference(e.reference) || e.utr !== null
  );
  if (identifiable.length === 0) {
    trace.push({
      stage: "identifier-check",
      kind: "DETERMINISTIC",
      detail: "No candidate carries a usable reference or bank identifier",
    });
    return escalate(
      record,
      "INVALID_REFERENCE",
      "The settlement row carries no usable reference or bank identifier.",
      "Request an enriched settlement file from the provider, or match manually against the bank statement narration.",
      "Nothing in the provider's row identifies which instruction it belongs to. The amount may well correspond, but an amount does not identify a payment - several instructions can share one.",
      0,
      [],
      trace
    );
  }

  /* --- Structural: duplicates and split settlements ------------------ */

  const scored = externals
    .map((e) => scoreCandidate(internal, e))
    .sort((a, b) => b.confidence - a.confidence);

  trace.push({
    stage: "candidate-scoring",
    kind: "STATISTICAL",
    detail: scored
      .map((s) => `${s.externalId} ${(s.confidence * 100).toFixed(1)}%`)
      .join(", "),
  });

  /*
   * Candidates worth taking seriously — the FLOOR, not the auto-resolve bar.
   *
   * This gate used to require both rows to clear 90%, which meant it could
   * never fire: a genuine double-send carries a different UTR, so the second
   * settlement scores about 70% and the check saw only one "strong" candidate.
   * The benchmark found this immediately — every duplicate and every ambiguous
   * record was auto-resolved against the first row, 23 false resolutions.
   *
   * The lesson generalises. A second settlement for one instruction is a
   * STRUCTURAL fact, and testing for it with a confidence threshold tuned for
   * a different purpose meant the most expensive error class in the system was
   * gated behind a number that had nothing to do with it.
   */
  const credible = scored.filter(
    (s) => s.confidence >= THRESHOLDS.candidateFloor
  );

  if (credible.length > 1) {
    const [a, b] = credible;
    const extA = externals.find((e) => e.id === a.externalId)!;
    const extB = externals.find((e) => e.id === b.externalId)!;
    const sameAmount = extA.amountPaise === extB.amountPaise;
    const sameReference =
      normaliseReference(extA.reference) === normaliseReference(extB.reference);
    const differentUtr = extA.utr !== extB.utr;
    const sameDate = extA.valueDate === extB.valueDate;

    /*
     * Two settlements carrying the same reference and the same amount are one
     * instruction that has been paid twice, or two rows we cannot tell apart.
     * Either way the record is not safe to clear, and that safety property
     * does NOT depend on getting the subtype right.
     *
     * The subtype itself is a triage hint, not a determination: same-day reads
     * as a double-send, a later date reads as two candidates needing
     * disambiguation. A real duplicate can settle the next day and break that
     * heuristic. It is recorded as a hint for the operator precisely because
     * the system cannot know.
     */
    if (sameAmount && sameReference && differentUtr && sameDate) {
      trace.push({
        stage: "duplicate-detection",
        kind: "POLICY",
        detail: "Two settlements, same amount and date, different bank references",
      });
      return escalate(
        record,
        "DUPLICATE",
        "This instruction appears to have been settled twice.",
        "Confirm both debits with the provider, then raise a recall on the later one. Do not net them off internally — the money has already left.",
        `Both ${a.externalId} and ${b.externalId} match at ${(a.confidence * 100).toFixed(0)}% confidence. High confidence is exactly the problem: matching against either one would clear the record and conceal a payment that has already gone out twice.`,
        a.confidence,
        a.comparisons,
        trace
      );
    }

    /*
     * Split settlement: several transfers under one reference that add up to
     * the instruction. Neither row is wrong and neither is a duplicate, but
     * clearing against either one alone books the invoice as paid in full
     * while part of it is still outstanding.
     */
    if (sameReference && !sameAmount) {
      const credibleTotal = credible.reduce((sum, c) => {
        const ext = externals.find((e) => e.id === c.externalId)!;
        return sum + ext.amountPaise;
      }, 0);

      if (credibleTotal === internal.amountPaise) {
        trace.push({
          stage: "split-settlement-check",
          kind: "POLICY",
          detail: `${credible.length} settlements sum exactly to the instruction`,
        });
        return escalate(
          record,
          "PARTIAL_SETTLEMENT",
          `Settled across ${credible.length} transfers that sum to the instructed amount.`,
          "Link all parts to the invoice as a single settlement group before clearing it. Confirm no further transfer is outstanding.",
          "No single settlement row equals the invoice, so matching against the largest one would record the invoice as fully paid while the remainder is still open. The parts only reconcile as a set.",
          a.confidence,
          a.comparisons,
          trace
        );
      }
    }

    if (sameAmount && sameReference) {
      trace.push({
        stage: "ambiguity-check",
        kind: "POLICY",
        detail: `${credible.length} settlements share this reference and amount`,
      });
      return escalate(
        record,
        "AMBIGUOUS",
        "More than one settlement matches this instruction equally well.",
        "Ask the provider which settlement carries our reference. Do not guess — a wrong link is harder to unwind than an open exception.",
        `${a.externalId} and ${b.externalId} score ${(a.confidence * 100).toFixed(0)}% and ${(b.confidence * 100).toFixed(0)}%. Nothing in the evidence separates them, so any choice would be arbitrary and the audit trail would record a certainty the system does not have.`,
        a.confidence,
        a.comparisons,
        trace
      );
    }
  }

  const best = scored[0];
  const bestExternal = externals.find((e) => e.id === best.externalId)!;

  /* --- No credible candidate ---------------------------------------- */

  if (best.confidence < THRESHOLDS.candidateFloor) {
    const refUnusable =
      normaliseReference(bestExternal.reference).length === 0 ||
      bestExternal.reference === "NARRATION UNAVAILABLE";

    return escalate(
      record,
      refUnusable ? "INVALID_REFERENCE" : "LOW_CONFIDENCE",
      refUnusable
        ? "The settlement row carries no usable reference or bank identifier."
        : "No settlement row resembles this instruction closely enough to link.",
      refUnusable
        ? "Request an enriched settlement file from the provider, or match manually against the bank statement narration."
        : "Review by hand against the provider portal.",
      `Best candidate scored ${(best.confidence * 100).toFixed(0)}%, below the ${(THRESHOLDS.candidateFloor * 100).toFixed(0)}% floor for a credible link. The amount may well correspond, but amount alone does not identify a payment.`,
      best.confidence,
      best.comparisons,
      trace
    );
  }

  /* --- Policy gates on a scored candidate --------------------------- */

  trace.push({
    stage: "policy-gates",
    kind: "POLICY",
    detail: `Evaluating ${best.externalId} at ${(best.confidence * 100).toFixed(1)}%`,
  });

  /*
   * Counterparty first. Paying the wrong company is worse than paying the
   * wrong amount to the right one: the amount can be corrected with the same
   * counterparty, but money sent to the wrong party is gone until they return
   * it voluntarily.
   */
  if (
    normaliseParty(internal.supplierName) !==
    normaliseParty(bestExternal.beneficiaryName)
  ) {
    return escalate(
      record,
      "COUNTERPARTY_MISMATCH",
      `Instructed to ${internal.supplierName}; the provider paid ${bestExternal.beneficiaryName}.`,
      "Stop any further payments to this beneficiary and raise a recall with the provider. Confirm the mandate before re-instructing.",
      "Reference, amount, date and bank identifier all agree - which is exactly why this needs a human. Every field except the beneficiary says the record is correct, so a matcher that does not compare the counterparty clears it with full confidence.",
      best.confidence,
      best.comparisons,
      trace
    );
  }

  const amountDelta = Math.abs(internal.amountPaise - bestExternal.amountPaise);
  if (amountDelta > THRESHOLDS.amountTolerancePaise) {
    return escalate(
      record,
      "AMOUNT_MISMATCH",
      `Settled amount differs from the instruction by ${amountDelta} paise.`,
      "Confirm the settled figure with the provider and post a correcting entry. Do not clear the original.",
      `The records refer to the same payment — reference and bank identifier agree — but the amounts do not. The tolerance is zero paise deliberately: a payment that settled short is a different payment, and a tolerance wide enough to absorb this is wide enough to absorb a real loss at volume.`,
      best.confidence,
      best.comparisons,
      trace
    );
  }

  const statusConsistent =
    (internal.status === "CONFIRMED" && bestExternal.status === "captured") ||
    (internal.status === "FAILED" && bestExternal.status === "failed");

  if (!statusConsistent) {
    return escalate(
      record,
      "STATUS_MISMATCH",
      `We hold this as ${internal.status}; the provider reports "${bestExternal.status}".`,
      "Establish which book is wrong before touching either. If the provider is right, reverse the internal entry rather than editing it.",
      "The two systems disagree about whether money moved. Auto-resolving would pick a winner between two books of record on no evidence, and the ledger would then be confidently wrong.",
      best.confidence,
      best.comparisons,
      trace
    );
  }

  const taxDelta = Math.abs(internal.taxPaise - bestExternal.taxPaise);
  if (taxDelta > 0) {
    return escalate(
      record,
      "TAX_MISMATCH",
      `Gross amounts agree but the tax component differs by ${taxDelta} paise.`,
      "Reconcile the tax split against the invoice before filing. The gross figure is not the number that goes on a GST return.",
      "A matcher that compares totals would clear this record. The totals are not the problem — the split is, and it feeds a statutory filing.",
      best.confidence,
      best.comparisons,
      trace
    );
  }

  if (best.confidence < THRESHOLDS.autoResolve) {
    return escalate(
      record,
      "LOW_CONFIDENCE",
      `Best candidate scored ${(best.confidence * 100).toFixed(0)}%, below the auto-resolution threshold.`,
      "Confirm the link by hand. If it is correct, the evidence pattern is worth feeding back into the matcher.",
      `Confidence ${(best.confidence * 100).toFixed(0)}% is under the ${(THRESHOLDS.autoResolve * 100).toFixed(0)}% bar. Nothing is demonstrably wrong with this record — the system simply is not certain enough to clear it unsupervised, which is the correct behaviour when in doubt.`,
      best.confidence,
      best.comparisons,
      trace
    );
  }

  /* --- Clear it ------------------------------------------------------ */

  trace.push({
    stage: "auto-resolve",
    kind: "POLICY",
    detail: `Cleared against ${best.externalId}`,
  });

  return {
    recordId: record.recordId,
    outcome: "AUTO_RESOLVED",
    matchedExternalId: best.externalId,
    confidence: best.confidence,
    exceptionType: null,
    reason: `Matched to ${best.externalId}: reference, bank identifier, amount and value date all agree.`,
    recommendedAction: "",
    whyNotAutoResolved: "",
    amountPaise: internal.amountPaise,
    comparisons: best.comparisons,
    trace,
    controllerVersion: CONTROLLER_VERSION,
  };
}

/* ------------------------------------------------------------- Baseline */

/**
 * The rule this has to beat: exact reference string AND exact amount.
 *
 * Included because "our matcher scored 94%" is meaningless without knowing
 * what a trivial rule scores. If the baseline is close, the machinery is not
 * earning its complexity.
 */
export function processRecordBaseline(
  record: BenchmarkRecord
): ControllerDecision {
  const { internal, externals } = record;
  const base = {
    recordId: record.recordId,
    confidence: 0,
    comparisons: [] as FieldComparison[],
    trace: [
      {
        stage: "exact-match-rule",
        kind: "DETERMINISTIC" as StageKind,
        detail: "Exact reference string and exact amount",
      },
    ],
    controllerVersion: "baseline-exact-match-1.0.0",
    amountPaise:
      record.internal?.amountPaise ?? record.externals[0]?.amountPaise ?? 0,
    recommendedAction: "Review by hand.",
    whyNotAutoResolved: "No exact reference-and-amount match.",
  };

  if (internal === null || externals.length === 0) {
    return {
      ...base,
      outcome: "UNMATCHED",
      matchedExternalId: null,
      exceptionType: internal === null ? "MISSING_INTERNAL" : "MISSING_EXTERNAL",
      reason: "One side of the pair is absent.",
    };
  }

  const hit = externals.find(
    (e) =>
      e.reference === internal.reference &&
      e.amountPaise === internal.amountPaise
  );

  if (!hit) {
    return {
      ...base,
      outcome: "NEEDS_REVIEW",
      matchedExternalId: null,
      exceptionType: "LOW_CONFIDENCE",
      reason: "No row matched on exact reference and amount.",
    };
  }

  return {
    ...base,
    outcome: "AUTO_RESOLVED",
    matchedExternalId: hit.id,
    confidence: 1,
    exceptionType: null,
    reason: `Exact match on reference and amount against ${hit.id}.`,
    recommendedAction: "",
    whyNotAutoResolved: "",
  };
}

/** Map a ground-truth label to the exception type a correct run should raise. */
export function expectedExceptionFor(
  label: GroundTruthLabel
): ExceptionType | null {
  if (label === "MATCHED") return null;
  return label as ExceptionType;
}
