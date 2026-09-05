/**
 * The Track 04 finance-operations benchmark dataset.
 *
 * 546 reconciliation subjects, each one an internal record (what we believe
 * happened) set against zero or more external provider records (what the
 * provider says happened), with a ground-truth label stating what the right
 * answer is.
 *
 * Three things make this a benchmark rather than a demo fixture:
 *
 *   1. Every record carries a LABEL and an EXPECTED ACTION, so accuracy is
 *      measurable rather than asserted. A pipeline that produces confident
 *      output on unlabelled data cannot be scored, and "it looked right" is
 *      not a metric.
 *   2. It is split into TUNING and HELD_OUT. Matching thresholds are tuned
 *      against the tuning split only; every headline number is reported on the
 *      held-out split. Tuning and reporting on the same records measures
 *      memorisation.
 *   3. It is generated from a fixed seed and a versioned generator, so the
 *      same command produces the same 546 records and the same score on any
 *      machine.
 *
 * Amounts are drawn from the population calibrated to published Indian MSME
 * data (see ../benchmark/population-calibration.ts) rather than from round
 * numbers, so the value distribution has the right shape and the financial
 * materiality figures mean something.
 */

import {
  TURNOVER_FIT,
  PAYMENT_BEHAVIOUR,
  ASSUMPTIONS,
  probit,
  normalCdf,
} from "../benchmark/population-calibration";

/** Bump when the generator changes shape. Reported with every benchmark run. */
export const DATASET_VERSION = "track04-dataset-1.1.0";
export const DATASET_SEED = 20260904;
export const DATASET_SIZE = 546;

/** GST rate applied to the taxable value of a B2B invoice. */
const GST_RATE = 0.18;

/* --------------------------------------------------------------- Taxonomy */

/**
 * What is actually wrong with a record. Deliberately an honest taxonomy: these
 * are the failure modes a reconciliation desk sees, not a list chosen because
 * they are easy to detect.
 */
export type GroundTruthLabel =
  | "MATCHED"
  | "AMOUNT_MISMATCH"
  | "STATUS_MISMATCH"
  | "MISSING_EXTERNAL"
  | "MISSING_INTERNAL"
  | "DUPLICATE"
  | "TAX_MISMATCH"
  | "INVALID_REFERENCE"
  | "AMBIGUOUS"
  | "COUNTERPARTY_MISMATCH"
  | "PARTIAL_SETTLEMENT";

/** The finance workflow a record belongs to. */
export type Scenario =
  | "INVOICE_PAYMENT_MATCH"
  | "SETTLEMENT_RECONCILIATION"
  | "DUPLICATE_PAYMENT_DETECTION"
  | "MISSING_SETTLEMENT_DETECTION"
  | "ORPHAN_SETTLEMENT"
  | "STATUS_DIVERGENCE"
  | "AMOUNT_DIVERGENCE"
  | "TAX_DIVERGENCE"
  | "REFERENCE_INTEGRITY"
  | "AMBIGUOUS_CANDIDATES"
  | "COUNTERPARTY_VERIFICATION"
  | "PARTIAL_SETTLEMENT";

/**
 * How hard the record is. Reported separately, because an aggregate score over
 * a dataset that is 90% trivial says nothing about the cases that cost money.
 */
export type Difficulty = "EASY" | "MEDIUM" | "HARD" | "AMBIGUOUS";

export type Split = "TUNING" | "HELD_OUT";

/** What a correct system should DO, which is not the same as what is wrong. */
export type ExpectedAction = "AUTO_RESOLVE" | "ESCALATE";

export interface InternalRecord {
  id: string;
  reference: string;
  amountPaise: number;
  taxPaise: number;
  status: "CONFIRMED" | "SUBMITTED" | "UNKNOWN" | "FAILED";
  supplierId: string;
  supplierName: string;
  valueDate: string;
  utr: string | null;
}

export interface ExternalRecord {
  id: string;
  reference: string;
  /**
   * Who the provider actually paid. Real settlement files carry this, and
   * omitting it from the first version of this benchmark hid a genuine gap:
   * the controller was matching on reference and amount without ever checking
   * that the money went to the right counterparty.
   */
  beneficiaryName: string;
  amountPaise: number;
  taxPaise: number;
  status: "captured" | "pending" | "failed" | "refunded";
  valueDate: string;
  utr: string | null;
}

export interface GroundTruth {
  label: GroundTruthLabel;
  /** The external record that SHOULD be matched, when one should. */
  expectedMatchExternalId: string | null;
  expectedAction: ExpectedAction;
  /** Rupee value at stake if this record is handled wrongly. */
  materialityPaise: number;
  /** Why this record is the way it is. Written for a human reading a failure. */
  note: string;
}

export interface BenchmarkRecord {
  recordId: string;
  scenario: Scenario;
  difficulty: Difficulty;
  split: Split;
  internal: InternalRecord | null;
  externals: ExternalRecord[];
  groundTruth: GroundTruth;
}

/* -------------------------------------------------------------------- RNG */

/** Mulberry32, matching the trainer. Small, fast, reproducible. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUPPLIER_NAMES = [
  "Aarav Industrial Components",
  "Kaveri Logistics Parts",
  "Vindhya Textile Mills",
  "Nila Packaging Works",
  "Bhavani Agro Processing",
  "Girnar Auto Fasteners",
  "Saffron Retail Supply",
  "Konkan Marine Exports",
  "Orbit Kitchenware",
  "Deccan Print Solutions",
  "Meridian Home Goods",
  "Sundaram Electricals",
  "Nalanda Paper Mills",
  "Coromandel Steel Traders",
  "Anantha Rubber Works",
];

/* ------------------------------------------------------------- Generation */

interface Ctx {
  rng: () => number;
  counter: { n: number };
}

function pad(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}

/** A day offset from a fixed anchor, so dates are deterministic. */
function dateAt(offsetDays: number): string {
  const anchor = Date.UTC(2026, 7, 1); // 2026-08-01
  return new Date(anchor + offsetDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Invoice value drawn from the calibrated turnover distribution: a single
 * invoice is roughly one collection cycle's worth of a firm's daily revenue.
 * This keeps the benchmark's rupee amounts in the same distribution as the
 * rest of the system rather than being round made-up numbers.
 */
function drawAmountPaise(ctx: Ctx): number {
  const floor = ASSUMPTIONS.financeableTurnoverFloorRupees.value;
  const cdfAtFloor = normalCdf(
    (Math.log(floor) - TURNOVER_FIT.logMean) / TURNOVER_FIT.logSd
  );
  const u = cdfAtFloor + ctx.rng() * (1 - cdfAtFloor);
  const turnover = Math.exp(
    TURNOVER_FIT.logMean +
      TURNOVER_FIT.logSd * probit(Math.min(Math.max(u, 1e-9), 1 - 1e-9))
  );
  // One invoice ~ a fortnight of revenue, capped so a single record cannot
  // dominate the materiality totals.
  const dailyRevenueRupees = turnover / 365;
  const invoiceRupees = Math.min(dailyRevenueRupees * 14, 8_00_000);
  return Math.max(Math.round(invoiceRupees * 100), 50_000);
}

function makeUtr(ctx: Ctx): string {
  const digits = "0123456789";
  let s = "UTR";
  for (let i = 0; i < 12; i++) {
    s += digits[Math.floor(ctx.rng() * 10)];
  }
  return s;
}

function makeInternal(ctx: Ctx, index: number): InternalRecord {
  const gross = drawAmountPaise(ctx);
  // Gross = taxable + 18% GST, so taxable = gross / 1.18.
  const taxable = Math.round(gross / (1 + GST_RATE));
  const tax = gross - taxable;
  const supplierIndex = Math.floor(ctx.rng() * SUPPLIER_NAMES.length);

  return {
    id: `int_${pad(index)}`,
    reference: `EQB-2026-${pad(index, 5)}`,
    amountPaise: gross,
    taxPaise: tax,
    status: "CONFIRMED",
    supplierId: `sup_${pad(supplierIndex + 1, 3)}`,
    supplierName: SUPPLIER_NAMES[supplierIndex],
    valueDate: dateAt(Math.floor(ctx.rng() * 40)),
    utr: makeUtr(ctx),
  };
}

/** The provider's view of a payment that went through cleanly. */
function mirrorExternal(
  internal: InternalRecord,
  index: number,
  suffix = "a"
): ExternalRecord {
  return {
    id: `ext_${pad(index)}${suffix}`,
    reference: internal.reference,
    beneficiaryName: internal.supplierName,
    amountPaise: internal.amountPaise,
    taxPaise: internal.taxPaise,
    status: "captured",
    valueDate: internal.valueDate,
    utr: internal.utr,
  };
}

interface Spec {
  label: GroundTruthLabel;
  scenario: Scenario;
  difficulty: Difficulty;
  count: number;
}

/**
 * The mix. Weighted towards clean records because that is what a real
 * settlement file looks like — but with enough of each defect that the
 * per-type rates are not computed from a handful of records.
 */
const COMPOSITION: Spec[] = [
  { label: "MATCHED", scenario: "INVOICE_PAYMENT_MATCH", difficulty: "EASY", count: 210 },
  { label: "MATCHED", scenario: "SETTLEMENT_RECONCILIATION", difficulty: "MEDIUM", count: 90 },
  { label: "MATCHED", scenario: "REFERENCE_INTEGRITY", difficulty: "HARD", count: 40 },
  { label: "AMOUNT_MISMATCH", scenario: "AMOUNT_DIVERGENCE", difficulty: "EASY", count: 22 },
  { label: "AMOUNT_MISMATCH", scenario: "AMOUNT_DIVERGENCE", difficulty: "HARD", count: 18 },
  { label: "STATUS_MISMATCH", scenario: "STATUS_DIVERGENCE", difficulty: "EASY", count: 30 },
  { label: "MISSING_EXTERNAL", scenario: "MISSING_SETTLEMENT_DETECTION", difficulty: "EASY", count: 30 },
  { label: "MISSING_INTERNAL", scenario: "ORPHAN_SETTLEMENT", difficulty: "EASY", count: 20 },
  { label: "DUPLICATE", scenario: "DUPLICATE_PAYMENT_DETECTION", difficulty: "MEDIUM", count: 25 },
  { label: "TAX_MISMATCH", scenario: "TAX_DIVERGENCE", difficulty: "HARD", count: 15 },
  { label: "INVALID_REFERENCE", scenario: "REFERENCE_INTEGRITY", difficulty: "MEDIUM", count: 12 },
  { label: "AMBIGUOUS", scenario: "AMBIGUOUS_CANDIDATES", difficulty: "AMBIGUOUS", count: 8 },
  { label: "COUNTERPARTY_MISMATCH", scenario: "COUNTERPARTY_VERIFICATION", difficulty: "HARD", count: 14 },
  { label: "PARTIAL_SETTLEMENT", scenario: "PARTIAL_SETTLEMENT", difficulty: "HARD", count: 12 },
];

function buildRecord(
  ctx: Ctx,
  spec: Spec,
  index: number
): BenchmarkRecord {
  const internal = makeInternal(ctx, index);
  const recordId = `rec_${pad(index)}`;
  let externals: ExternalRecord[] = [];
  let internalOut: InternalRecord | null = internal;
  let expectedMatchExternalId: string | null = null;
  let expectedAction: ExpectedAction = "ESCALATE";
  let materialityPaise = internal.amountPaise;
  let note = "";

  switch (spec.label) {
    case "MATCHED": {
      const ext = mirrorExternal(internal, index);

      if (spec.difficulty === "MEDIUM") {
        // Settlement files arrive a day or two after capture, and the provider
        // pads its own reference. Same payment, cosmetically different row.
        ext.valueDate = dateAt(
          Number(internal.valueDate.slice(8)) + 1 + Math.floor(ctx.rng() * 2)
        );
        ext.reference = `RZP/${internal.reference}`;
      }
      if (spec.difficulty === "HARD") {
        /*
         * The reference survives a round-trip through a bank file: case
         * folded, separators stripped, whitespace introduced. A human reads
         * these as obviously the same; an exact-string rule does not, which is
         * precisely where the baseline loses.
         */
        ext.reference = internal.reference
          .toLowerCase()
          .replace(/-/g, " ")
          .replace(/(\w{3})/, "$1 ");
        ext.utr = internal.utr;
      }

      externals = [ext];
      expectedMatchExternalId = ext.id;
      expectedAction = "AUTO_RESOLVE";
      materialityPaise = internal.amountPaise;
      note =
        spec.difficulty === "HARD"
          ? "Same payment. The provider's reference has been case-folded and re-spaced by an intermediary bank file."
          : "Clean settlement. Internal and external agree on amount, status and party.";
      break;
    }

    case "AMOUNT_MISMATCH": {
      const ext = mirrorExternal(internal, index);
      // EASY: obviously wrong. HARD: off by a rounding-sized amount, which is
      // where a naive tolerance rule silently auto-resolves a real loss.
      const deltaPaise =
        spec.difficulty === "EASY"
          ? Math.round(internal.amountPaise * (0.05 + ctx.rng() * 0.2))
          : Math.round(50 + ctx.rng() * 400);
      ext.amountPaise = internal.amountPaise - deltaPaise;
      externals = [ext];
      expectedMatchExternalId = null;
      materialityPaise = deltaPaise;
      note =
        spec.difficulty === "HARD"
          ? `Short-settled by ${deltaPaise} paise. Small enough to look like rounding, large enough to be real money at volume.`
          : `Provider settled ${deltaPaise} paise less than instructed.`;
      break;
    }

    case "STATUS_MISMATCH": {
      const ext = mirrorExternal(internal, index);
      ext.status = ctx.rng() < 0.5 ? "failed" : "pending";
      externals = [ext];
      expectedMatchExternalId = null;
      materialityPaise = internal.amountPaise;
      note = `We believe this is CONFIRMED; the provider reports "${ext.status}". Never auto-resolve a status divergence — one of the two books is wrong about whether money moved.`;
      break;
    }

    case "MISSING_EXTERNAL": {
      externals = [];
      expectedMatchExternalId = null;
      materialityPaise = internal.amountPaise;
      note =
        "We recorded a payment the provider has no record of. Either it never left, or the settlement file is incomplete.";
      break;
    }

    case "MISSING_INTERNAL": {
      const ext = mirrorExternal(internal, index);
      internalOut = null;
      externals = [ext];
      expectedMatchExternalId = null;
      materialityPaise = ext.amountPaise;
      note =
        "The provider settled money we have no instruction for. Unexplained outbound cash — the highest-priority class of exception.";
      break;
    }

    case "DUPLICATE": {
      const first = mirrorExternal(internal, index, "a");
      const second = mirrorExternal(internal, index, "b");
      // A genuine double-send: same reference and amount, different provider
      // id and UTR, minutes apart.
      second.utr = makeUtr(ctx);
      second.valueDate = internal.valueDate;
      externals = [first, second];
      expectedMatchExternalId = null;
      materialityPaise = internal.amountPaise;
      note =
        "The same instruction was settled twice. Auto-resolving against either row hides a duplicate payment that has already left the account.";
      break;
    }

    case "TAX_MISMATCH": {
      const ext = mirrorExternal(internal, index);
      // Gross agrees, the split does not — the classic GST reconciliation
      // failure that a gross-amount-only matcher cannot see at all.
      const shift = Math.round(ext.taxPaise * (0.1 + ctx.rng() * 0.3));
      ext.taxPaise = ext.taxPaise - shift;
      externals = [ext];
      expectedMatchExternalId = null;
      materialityPaise = shift;
      note =
        "Gross amounts agree but the tax component does not. Invisible to any matcher that only compares totals, and it is the number that goes on a GST return.";
      break;
    }

    case "INVALID_REFERENCE": {
      const ext = mirrorExternal(internal, index);
      ext.reference = ctx.rng() < 0.5 ? "" : "NARRATION UNAVAILABLE";
      ext.utr = null;
      externals = [ext];
      expectedMatchExternalId = null;
      materialityPaise = internal.amountPaise;
      note =
        "The settlement row carries no usable reference or UTR. The amount may well correspond, but nothing ties the two records together.";
      break;
    }

    case "COUNTERPARTY_MISMATCH": {
      /*
       * Reference and amount agree perfectly; the money went to a different
       * company. This is the case that exposes a matcher which never asks who
       * was paid — and it auto-resolves at 100% confidence, because on every
       * field it bothers to compare, everything agrees.
       */
      const ext = mirrorExternal(internal, index);
      const otherIndex =
        (SUPPLIER_NAMES.indexOf(internal.supplierName) + 1 + Math.floor(ctx.rng() * 3)) %
        SUPPLIER_NAMES.length;
      ext.beneficiaryName = SUPPLIER_NAMES[otherIndex];
      externals = [ext];
      expectedMatchExternalId = null;
      materialityPaise = internal.amountPaise;
      note =
        "Reference, amount, date and bank identifier all agree, but the provider paid a different company. Every field a naive matcher compares says this is correct.";
      break;
    }

    case "PARTIAL_SETTLEMENT": {
      /*
       * One instruction settled across two transfers that sum to the invoice.
       * Neither is a duplicate and neither is wrong, but clearing against
       * either one alone books the invoice as paid in full.
       */
      const first = mirrorExternal(internal, index, "a");
      const second = mirrorExternal(internal, index, "b");
      const firstPart = Math.round(internal.amountPaise * 0.6);
      first.amountPaise = firstPart;
      second.amountPaise = internal.amountPaise - firstPart;
      first.taxPaise = Math.round(internal.taxPaise * 0.6);
      second.taxPaise = internal.taxPaise - first.taxPaise;
      second.utr = makeUtr(ctx);
      externals = [first, second];
      expectedMatchExternalId = null;
      materialityPaise = internal.amountPaise;
      note =
        "Settled in two transfers that sum exactly to the invoice. Matching against either one alone would record the invoice as fully paid while 40% of it is still outstanding.";
      break;
    }

    case "AMBIGUOUS": {
      // Two externals, both plausible, nothing in the data to separate them.
      // A correct system says so instead of picking.
      const first = mirrorExternal(internal, index, "a");
      const second = mirrorExternal(internal, index, "b");
      second.utr = makeUtr(ctx);
      second.valueDate = dateAt(Number(internal.valueDate.slice(8)) + 1);
      second.reference = internal.reference;
      externals = [first, second];
      expectedMatchExternalId = null;
      materialityPaise = internal.amountPaise;
      note =
        "Two settlement rows match this instruction equally well and the evidence does not distinguish them. The only correct answer is to abstain.";
      break;
    }
  }

  return {
    recordId,
    scenario: spec.scenario,
    difficulty: spec.difficulty,
    // Assigned below, once the full list exists, so the split is stratified.
    split: "HELD_OUT",
    internal: internalOut,
    externals,
    groundTruth: {
      label: spec.label,
      expectedMatchExternalId,
      expectedAction,
      materialityPaise,
      note,
    },
  };
}

/**
 * Build the dataset. Deterministic: same seed, same 520 records, byte for byte.
 */
export function buildDataset(seed: number = DATASET_SEED): BenchmarkRecord[] {
  const ctx: Ctx = { rng: makeRng(seed), counter: { n: 0 } };
  const records: BenchmarkRecord[] = [];

  let index = 1;
  for (const spec of COMPOSITION) {
    for (let i = 0; i < spec.count; i++) {
      records.push(buildRecord(ctx, spec, index));
      index++;
    }
  }

  /*
   * Stratified split: every third record of each ground-truth label goes to
   * TUNING. Stratifying matters — a random split of 8 AMBIGUOUS records could
   * easily put all of them on one side and make that class unmeasurable.
   */
  const seen = new Map<GroundTruthLabel, number>();
  for (const record of records) {
    const n = (seen.get(record.groundTruth.label) ?? 0) + 1;
    seen.set(record.groundTruth.label, n);
    record.split = n % 3 === 0 ? "TUNING" : "HELD_OUT";
  }

  if (records.length !== DATASET_SIZE) {
    throw new Error(
      `Dataset composition sums to ${records.length}, expected ${DATASET_SIZE}. ` +
        "Update DATASET_SIZE and DATASET_VERSION together."
    );
  }

  return records;
}

/** Counts by label, split and difficulty — printed with every run. */
export function datasetSummary(records: BenchmarkRecord[]) {
  const by = <K extends string>(pick: (r: BenchmarkRecord) => K) => {
    const out: Record<string, number> = {};
    for (const r of records) out[pick(r)] = (out[pick(r)] ?? 0) + 1;
    return out;
  };

  return {
    version: DATASET_VERSION,
    seed: DATASET_SEED,
    total: records.length,
    byLabel: by((r) => r.groundTruth.label),
    bySplit: by((r) => r.split),
    byDifficulty: by((r) => r.difficulty),
    totalValuePaise: records.reduce(
      (s, r) => s + (r.internal?.amountPaise ?? r.externals[0]?.amountPaise ?? 0),
      0
    ),
    referenceCycleDays: PAYMENT_BEHAVIOUR.averageRealisedDays.value,
  };
}
