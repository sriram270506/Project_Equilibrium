/**
 * The adversarial set, and the robustness ladder.
 *
 * The main benchmark has a methodological weakness it states openly: the
 * dataset and the controller share an author, so it can only contain defects
 * somebody thought to plant. This file is the attempt to attack that.
 *
 * The difference is the design rule. The main dataset was written by asking
 * "what goes wrong on a reconciliation desk". These cases were written by
 * reading the controller's own code and asking "what does it ASSUME, and what
 * would happen if that assumption were false" — normalisation that strips too
 * much, a UTR treated as near-conclusive, a duplicate heuristic keyed on
 * same-day, a zero amount tolerance, a suffix-stripping party matcher.
 *
 * That is not the same as an independent author, and it does not pretend to
 * be. A defect class I cannot imagine is still invisible. But it is the
 * difference between testing what the controller was built for and testing
 * where it breaks, and the honest outcome is that it DOES break here: this set
 * is expected to score well below the main benchmark, and the failures are
 * reported rather than tuned away.
 */

import {
  type BenchmarkRecord,
  type ExternalRecord,
  type InternalRecord,
  type GroundTruthLabel,
} from "./dataset";

export const ADVERSARIAL_VERSION = "track04-adversarial-1.0.0";
export const ADVERSARIAL_SEED = 771103;

/** What each adversarial case is attacking. Printed with the results. */
export interface AttackNote {
  /** The controller assumption under test. */
  assumption: string;
  /** Why that assumption is not safe. */
  attack: string;
}

export interface AdversarialRecord extends BenchmarkRecord {
  attack: AttackNote;
}

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

const GST_RATE = 0.18;

function baseInternal(
  index: number,
  rng: () => number,
  supplierName = "Aarav Industrial Components"
): InternalRecord {
  const gross = Math.round((40_000 + rng() * 6_00_000) * 100);
  const taxable = Math.round(gross / (1 + GST_RATE));
  return {
    id: `adv_int_${index}`,
    reference: `EQB-2026-${String(90_000 + index)}`,
    amountPaise: gross,
    taxPaise: gross - taxable,
    status: "CONFIRMED",
    supplierId: `sup_adv_${index}`,
    supplierName,
    valueDate: "2026-08-15",
    utr: `UTR${String(100_000_000_000 + index * 7919)}`,
  };
}

function mirror(
  internal: InternalRecord,
  suffix = "a"
): ExternalRecord {
  return {
    id: `adv_ext_${internal.id.split("_").pop()}${suffix}`,
    reference: internal.reference,
    beneficiaryName: internal.supplierName,
    amountPaise: internal.amountPaise,
    taxPaise: internal.taxPaise,
    status: "captured",
    valueDate: internal.valueDate,
    utr: internal.utr,
  };
}

interface CaseSpec {
  kind: string;
  count: number;
  attack: AttackNote;
  build: (
    internal: InternalRecord,
    rng: () => number,
    index: number
  ) => {
    internal: InternalRecord | null;
    externals: ExternalRecord[];
    label: GroundTruthLabel;
    expectAutoResolve: boolean;
    matchExternalId: string | null;
    note: string;
  };
}

/**
 * Each case names the assumption it is attacking. If a case passes, that is
 * evidence the assumption holds; if it fails, the note says exactly what broke
 * and why.
 */
const CASES: CaseSpec[] = [
  {
    kind: "REFERENCE_COLLISION",
    count: 20,
    attack: {
      assumption:
        "normaliseReference strips every non-alphanumeric character, so cosmetically different references that mean the same invoice compare equal.",
      attack:
        "Two DIFFERENT invoices whose references collide once punctuation is removed. The normaliser cannot tell them apart, so a strong match is available against the wrong invoice.",
    },
    build: (internal, rng, i) => {
      // Our invoice EQB-2026-90001; the provider settled EQB/2026/90001,
      // which is a different invoice in a different numbering series that
      // normalises to the identical string.
      const ext = mirror(internal);
      ext.reference = internal.reference.replace(/-/g, "/");
      // ...but it is genuinely a different payment: different amount, and a
      // bank reference we have never seen.
      ext.amountPaise = internal.amountPaise + Math.round(10_000 + rng() * 90_000);
      ext.taxPaise = Math.round(ext.amountPaise * (GST_RATE / (1 + GST_RATE)));
      ext.utr = `UTR${String(900_000_000_000 + i)}`;
      return {
        internal,
        externals: [ext],
        label: "AMOUNT_MISMATCH",
        expectAutoResolve: false,
        matchExternalId: null,
        note: "The reference normalises to ours but belongs to a different numbering series. Everything else disagrees.",
      };
    },
  },
  {
    kind: "LEGITIMATE_TWIN",
    count: 18,
    attack: {
      assumption:
        "Two settlements with the same amount on the same day, under one reference, are a duplicate payment.",
      attack:
        "A supplier legitimately invoiced twice for the same amount on the same day under DIFFERENT references. Both settle. Neither is a duplicate, and escalating them wastes an operator's time on a routine event.",
    },
    build: (internal, _rng, i) => {
      // Only one of the two is this record's counterpart. The other exists in
      // the same file and looks identical apart from its reference.
      const ours = mirror(internal, "a");
      const twin = mirror(internal, "b");
      twin.reference = `EQB-2026-${String(95_000 + i)}`;
      twin.utr = `UTR${String(500_000_000_000 + i)}`;
      return {
        internal,
        externals: [ours, twin],
        label: "MATCHED",
        expectAutoResolve: true,
        matchExternalId: ours.id,
        note: "Two same-value settlements on one day for one supplier, under different invoice references. Routine, not a duplicate.",
      };
    },
  },
  {
    kind: "BENEFICIARY_ABBREVIATION",
    count: 16,
    attack: {
      assumption:
        "normaliseParty makes the same company compare equal across systems by folding case and dropping corporate suffixes.",
      attack:
        "The provider's file abbreviates the trading name. It is unambiguously the same company to any human, and the suffix rule does not touch it — so the counterparty gate fires on a correct payment.",
    },
    build: (internal) => {
      const ext = mirror(internal);
      ext.beneficiaryName = internal.supplierName
        .replace("Industrial", "Inds.")
        .replace("Components", "Components");
      return {
        internal,
        externals: [ext],
        label: "MATCHED",
        expectAutoResolve: true,
        matchExternalId: ext.id,
        note: "Same company, abbreviated trading name in the settlement file. Reference and UTR both agree.",
      };
    },
  },
  {
    kind: "PARTY_SUFFIX_COLLISION",
    count: 12,
    attack: {
      assumption:
        "Dropping PVT / LTD / CORP makes party comparison robust to how a name is written.",
      attack:
        "Two DIFFERENT legal entities whose names differ only by the suffix that gets dropped. After normalisation they are the same string, so the one check standing between us and paying the wrong company cannot see the difference.",
    },
    build: (internal, _rng, i) => {
      const distinct = { ...internal, supplierName: `Orbit Kitchenware Ltd ${i}` };
      const ext = mirror(distinct);
      // A different registered entity that normalises identically.
      ext.beneficiaryName = `Orbit Kitchenware Pvt Ltd ${i}`;
      return {
        internal: distinct,
        externals: [ext],
        label: "COUNTERPARTY_MISMATCH",
        expectAutoResolve: false,
        matchExternalId: null,
        note: "Two separately registered companies whose names collapse to the same normalised string once the corporate suffix is dropped.",
      };
    },
  },
  {
    kind: "UTR_REUSE",
    count: 14,
    attack: {
      assumption:
        "A UTR is a bank-assigned unique identifier, so agreement is near-conclusive — it carries the second-heaviest weight in the score.",
      attack:
        "The bank reused a UTR across a batch. It agrees on a settlement that is not ours, contributing 30 of 120 points to a match that should never have been considered.",
    },
    build: (internal, rng, i) => {
      const ext = mirror(internal);
      ext.reference = `EQB-2026-${String(70_000 + i)}`;
      ext.amountPaise = internal.amountPaise + Math.round(5_000 + rng() * 50_000);
      ext.taxPaise = Math.round(ext.amountPaise * (GST_RATE / (1 + GST_RATE)));
      // Same UTR, different payment.
      return {
        internal,
        externals: [ext],
        label: "AMOUNT_MISMATCH",
        expectAutoResolve: false,
        matchExternalId: null,
        note: "The bank reused this UTR on a different settlement. Reference and amount both disagree.",
      };
    },
  },
  {
    kind: "MISSING_BENEFICIARY",
    count: 14,
    attack: {
      assumption:
        "The beneficiary field is present and comparable on every settlement row.",
      attack:
        "The provider omitted the beneficiary. The comparison fails, so the counterparty gate raises COUNTERPARTY_MISMATCH — naming a specific and alarming cause when the truth is only that a field is absent. The money is safe; the operator is sent to the wrong place.",
    },
    build: (internal) => {
      const ext = mirror(internal);
      ext.beneficiaryName = "";
      return {
        internal,
        externals: [ext],
        label: "INVALID_REFERENCE",
        expectAutoResolve: false,
        matchExternalId: null,
        note: "Everything identifying agrees, but the settlement file carries no beneficiary at all. That is a data-quality exception, not a wrong-payee exception.",
      };
    },
  },
  {
    kind: "THREE_WAY_SPLIT",
    count: 12,
    attack: {
      assumption:
        "A split settlement is two transfers that sum to the invoice.",
      attack:
        "Three transfers, the smallest of which scores below the credible-candidate floor. If it is filtered out before the sum is taken, the remaining two do not add up and the record is misread.",
    },
    build: (internal) => {
      const a = mirror(internal, "a");
      const b = mirror(internal, "b");
      const c = mirror(internal, "c");
      const first = Math.round(internal.amountPaise * 0.55);
      const second = Math.round(internal.amountPaise * 0.4);
      a.amountPaise = first;
      b.amountPaise = second;
      c.amountPaise = internal.amountPaise - first - second;
      b.utr = null;
      c.utr = null;
      c.valueDate = "2026-08-25";
      return {
        internal,
        externals: [a, b, c],
        label: "PARTIAL_SETTLEMENT",
        expectAutoResolve: false,
        matchExternalId: null,
        note: "Settled in three transfers summing exactly to the invoice, the last one small and late.",
      };
    },
  },
  {
    kind: "SCALE_ERROR",
    count: 10,
    attack: {
      assumption:
        "Both sides report amounts in the same unit, so an integer comparison of amountPaise is meaningful without checking scale.",
      attack:
        "The provider reported rupees. The figures differ by a factor of 100, which is an amount mismatch — but a system that ever normalises units on the fly would silently reconcile a payment a hundred times too small.",
    },
    build: (internal) => {
      const ext = mirror(internal);
      ext.amountPaise = Math.round(internal.amountPaise / 100);
      ext.taxPaise = Math.round(internal.taxPaise / 100);
      return {
        internal,
        externals: [ext],
        label: "AMOUNT_MISMATCH",
        expectAutoResolve: false,
        matchExternalId: null,
        note: "The settlement row is denominated in rupees, not paise.",
      };
    },
  },
  {
    kind: "LATE_BUT_LEGITIMATE",
    count: 14,
    attack: {
      assumption:
        "A settlement more than three days from the value date, with no bank reference, is not credible enough to clear.",
      attack:
        "A genuine settlement delayed by a bank holiday weekend, on a file that carries no UTR. Reference, amount and beneficiary all agree and it is unambiguously the right payment, but the score falls below the auto-resolve bar on two weak fields.",
    },
    build: (internal) => {
      const ext = mirror(internal);
      ext.valueDate = "2026-08-24";
      ext.utr = null;
      return {
        internal,
        externals: [ext],
        label: "MATCHED",
        expectAutoResolve: true,
        matchExternalId: ext.id,
        note: "Delayed nine days over a holiday weekend, settlement file carries no UTR. Reference, amount and beneficiary all agree exactly.",
      };
    },
  },
  {
    kind: "REFUND_NOT_FAILURE",
    count: 10,
    attack: {
      assumption:
        "Provider status maps onto ours as captured/CONFIRMED or failed/FAILED, and anything else is a status divergence.",
      attack:
        "The payment succeeded and was later refunded. That is not a divergence about whether money moved — both books agree it did — it is a subsequent event with a different remedy.",
    },
    build: (internal) => {
      const ext = mirror(internal);
      ext.status = "refunded";
      return {
        internal,
        externals: [ext],
        label: "STATUS_MISMATCH",
        expectAutoResolve: false,
        matchExternalId: null,
        note: "Captured then refunded. Escalation is correct; the reason an operator is given matters, because a refund and a failure need different responses.",
      };
    },
  },
];

/** Build the adversarial set. Deterministic, like everything else here. */
export function buildAdversarialSet(
  seed: number = ADVERSARIAL_SEED
): AdversarialRecord[] {
  const rng = makeRng(seed);
  const records: AdversarialRecord[] = [];
  let index = 1;

  for (const spec of CASES) {
    for (let i = 0; i < spec.count; i++) {
      const internal = baseInternal(index, rng);
      const built = spec.build(internal, rng, index);

      records.push({
        recordId: `adv_${String(index).padStart(4, "0")}`,
        scenario: "INVOICE_PAYMENT_MATCH",
        difficulty: "HARD",
        split: "HELD_OUT",
        internal: built.internal,
        externals: built.externals,
        groundTruth: {
          label: built.label,
          expectedMatchExternalId: built.matchExternalId,
          expectedAction: built.expectAutoResolve
            ? "AUTO_RESOLVE"
            : "ESCALATE",
          materialityPaise:
            built.internal?.amountPaise ??
            built.externals[0]?.amountPaise ??
            1,
          note: built.note,
        },
        attack: spec.attack,
      });
      index++;
    }
  }

  return records;
}

/** The attack notes, grouped by case kind, for reporting. */
export function attackCatalogue() {
  return CASES.map((c) => ({
    kind: c.kind,
    count: c.count,
    ...c.attack,
  }));
}

/* ------------------------------------------------------- Robustness ladder */

export type PerturbationName =
  | "reference-noise"
  | "beneficiary-variants"
  | "date-jitter"
  | "dropped-identifiers";

export interface Perturbation {
  name: PerturbationName;
  description: string;
  /** Share of records touched. */
  rate: number;
  apply: (
    record: BenchmarkRecord,
    rng: () => number
  ) => BenchmarkRecord;
}

function cloneRecord(record: BenchmarkRecord): BenchmarkRecord {
  return {
    ...record,
    internal: record.internal ? { ...record.internal } : null,
    externals: record.externals.map((e) => ({ ...e })),
    groundTruth: { ...record.groundTruth },
  };
}

/**
 * Degradations applied to the MAIN dataset, cumulatively.
 *
 * The ground truth is deliberately unchanged: every perturbation here is
 * cosmetic, so a correct system's answer should not move. Any drop in the
 * match rate is the controller being brittle about presentation rather than
 * substance — which is the property being measured.
 */
export const PERTURBATIONS: Perturbation[] = [
  {
    name: "reference-noise",
    description:
      "References arrive lower-cased, re-spaced, or carrying a provider prefix, as they do after a round trip through a bank file.",
    rate: 0.5,
    apply: (record, rng) => {
      const copy = cloneRecord(record);
      for (const ext of copy.externals) {
        if (rng() > 0.5) continue;
        const style = Math.floor(rng() * 3);
        if (style === 0) ext.reference = ext.reference.toLowerCase();
        else if (style === 1) ext.reference = `RZP/${ext.reference}`;
        else ext.reference = ext.reference.replace(/-/g, " ");
      }
      return copy;
    },
  },
  {
    name: "beneficiary-variants",
    description:
      "Beneficiary names carry corporate suffixes, extra punctuation, or different casing between the two systems.",
    rate: 0.5,
    apply: (record, rng) => {
      const copy = cloneRecord(record);
      for (const ext of copy.externals) {
        if (rng() > 0.5) continue;
        const style = Math.floor(rng() * 3);
        if (style === 0) ext.beneficiaryName = `${ext.beneficiaryName} Pvt Ltd`;
        else if (style === 1) ext.beneficiaryName = ext.beneficiaryName.toUpperCase();
        else ext.beneficiaryName = ext.beneficiaryName.replace(/ /g, "  ");
      }
      return copy;
    },
  },
  {
    name: "date-jitter",
    description:
      "Settlement value dates land one to three days after capture, inside the stated tolerance.",
    rate: 0.6,
    apply: (record, rng) => {
      const copy = cloneRecord(record);
      for (const ext of copy.externals) {
        if (rng() > 0.6) continue;
        const shift = 1 + Math.floor(rng() * 3);
        const d = new Date(Date.parse(ext.valueDate) + shift * 86400000);
        ext.valueDate = d.toISOString().slice(0, 10);
      }
      return copy;
    },
  },
  {
    name: "dropped-identifiers",
    description:
      "The settlement file omits the UTR on some rows, as a thinner bank feed would.",
    rate: 0.3,
    apply: (record, rng) => {
      const copy = cloneRecord(record);
      for (const ext of copy.externals) {
        if (rng() > 0.3) continue;
        ext.utr = null;
      }
      return copy;
    },
  },
];

/**
 * Apply perturbations cumulatively, returning one dataset per rung.
 *
 * Cumulative rather than independent because that is how a real feed degrades:
 * the file that abbreviates names is usually also the one that drops UTRs.
 */
export function robustnessLadder(
  base: BenchmarkRecord[],
  seed = 424242
): Array<{ label: string; description: string; records: BenchmarkRecord[] }> {
  const rungs: Array<{
    label: string;
    description: string;
    records: BenchmarkRecord[];
  }> = [{ label: "baseline", description: "Unmodified dataset.", records: base }];

  let current = base;
  for (const perturbation of PERTURBATIONS) {
    const rng = makeRng(seed + perturbation.name.length);
    current = current.map((r) => perturbation.apply(r, rng));
    rungs.push({
      label: `+ ${perturbation.name}`,
      description: perturbation.description,
      records: current,
    });
  }

  return rungs;
}
