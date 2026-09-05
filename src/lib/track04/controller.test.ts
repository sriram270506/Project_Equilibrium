import { describe, it, expect } from "vitest";
import {
  buildDataset,
  DATASET_SEED,
  DATASET_SIZE,
  type BenchmarkRecord,
} from "./dataset";
import {
  processRecord,
  processRecordBaseline,
  normaliseReference,
  normaliseParty,
  isUsableReference,
  scoreCandidate,
  THRESHOLDS,
} from "./controller";
import { evaluate } from "./evaluate";

/**
 * These tests pin the two properties that actually matter for a finance
 * controller: it is reproducible, and it never clears a record that needs a
 * human. Everything else is a performance detail.
 */

const records = buildDataset(DATASET_SEED);
const heldOut = records.filter((r) => r.split === "HELD_OUT");

function firstWithLabel(label: string): BenchmarkRecord {
  const found = records.find((r) => r.groundTruth.label === label);
  if (!found) throw new Error(`No record with label ${label}`);
  return found;
}

describe("dataset", () => {
  it("is deterministic across builds", () => {
    const a = buildDataset(DATASET_SEED);
    const b = buildDataset(DATASET_SEED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("changes when the seed changes", () => {
    const other = buildDataset(DATASET_SEED + 1);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(records));
  });

  it("holds the declared number of records", () => {
    expect(records).toHaveLength(DATASET_SIZE);
  });

  it("stratifies the split so every label appears on both sides", () => {
    const labels = new Set(records.map((r) => r.groundTruth.label));
    for (const label of labels) {
      const rows = records.filter((r) => r.groundTruth.label === label);
      expect(rows.some((r) => r.split === "HELD_OUT")).toBe(true);
      expect(rows.some((r) => r.split === "TUNING")).toBe(true);
    }
  });

  it("labels every record with an expected action and a materiality", () => {
    for (const r of records) {
      expect(["AUTO_RESOLVE", "ESCALATE"]).toContain(
        r.groundTruth.expectedAction
      );
      expect(r.groundTruth.materialityPaise).toBeGreaterThan(0);
      expect(r.groundTruth.note.length).toBeGreaterThan(20);
    }
  });

  it("only marks a record auto-resolvable when it is genuinely clean", () => {
    for (const r of records) {
      if (r.groundTruth.expectedAction === "AUTO_RESOLVE") {
        expect(r.groundTruth.label).toBe("MATCHED");
        expect(r.groundTruth.expectedMatchExternalId).not.toBeNull();
      }
    }
  });
});

describe("normalisation", () => {
  it("sees through the cosmetic mangling a bank file applies", () => {
    expect(normaliseReference("EQB-2026-00042")).toBe("EQB202600042");
    expect(normaliseReference("RZP/EQB-2026-00042")).toBe("EQB202600042");
    expect(normaliseReference("eqb 202 6 00042".toUpperCase())).toBe(
      "EQB202600042"
    );
  });

  it("treats placeholder narrations as no reference at all", () => {
    expect(isUsableReference("")).toBe(false);
    expect(isUsableReference("NARRATION UNAVAILABLE")).toBe(false);
    expect(isUsableReference("N/A")).toBe(false);
    expect(isUsableReference("EQB-2026-00042")).toBe(true);
  });

  it("ignores corporate suffixes when comparing parties", () => {
    expect(normaliseParty("Aarav Industrial Pvt Ltd")).toBe(
      normaliseParty("AARAV INDUSTRIAL")
    );
    expect(normaliseParty("Aarav Industrial")).not.toBe(
      normaliseParty("Kaveri Logistics")
    );
  });
});

describe("scoring", () => {
  it("scores a clean pair at full confidence", () => {
    const clean = firstWithLabel("MATCHED");
    const score = scoreCandidate(clean.internal!, clean.externals[0]);
    expect(score.confidence).toBeGreaterThanOrEqual(THRESHOLDS.autoResolve);
  });

  it("records a comparison for every field it used", () => {
    const clean = firstWithLabel("MATCHED");
    const score = scoreCandidate(clean.internal!, clean.externals[0]);
    const fields = score.comparisons.map((c) => c.field);
    expect(fields).toContain("reference");
    expect(fields).toContain("amount");
    expect(fields).toContain("beneficiary");
    expect(fields).toContain("utr");
  });
});

describe("the safety property", () => {
  /*
   * The single most important assertion in this file. Everything else is
   * about how well the controller performs; this is about whether it is safe
   * to run at all.
   */
  it("never auto-resolves a record that should be escalated", () => {
    const violations = records
      .map((record) => ({ record, decision: processRecord(record) }))
      .filter(
        ({ record, decision }) =>
          record.groundTruth.expectedAction === "ESCALATE" &&
          decision.outcome === "AUTO_RESOLVED"
      );

    expect(
      violations.map(
        (v) => `${v.record.recordId} (${v.record.groundTruth.label})`
      )
    ).toEqual([]);
  });

  it("refuses to pick between two indistinguishable settlements", () => {
    const ambiguous = firstWithLabel("AMBIGUOUS");
    const decision = processRecord(ambiguous);
    expect(decision.outcome).not.toBe("AUTO_RESOLVED");
    expect(decision.matchedExternalId).toBeNull();
  });

  it("catches a payment made to the wrong company", () => {
    const wrongParty = firstWithLabel("COUNTERPARTY_MISMATCH");
    const decision = processRecord(wrongParty);
    expect(decision.outcome).toBe("NEEDS_REVIEW");
    expect(decision.exceptionType).toBe("COUNTERPARTY_MISMATCH");
    // Every other field agrees, which is exactly why this needs a gate rather
    // than a confidence threshold.
    expect(decision.confidence).toBeGreaterThan(0.7);
  });

  it("does not treat a split settlement as a duplicate", () => {
    const partial = firstWithLabel("PARTIAL_SETTLEMENT");
    const decision = processRecord(partial);
    expect(decision.exceptionType).toBe("PARTIAL_SETTLEMENT");
  });

  it("holds a zero-paise amount tolerance", () => {
    // A tolerance above zero is how short settlements get cleared at volume.
    expect(THRESHOLDS.amountTolerancePaise).toBe(0);
  });
});

describe("explainability", () => {
  it("gives every escalation a reason, an action and a why-not", () => {
    for (const record of heldOut) {
      const decision = processRecord(record);
      if (decision.outcome === "AUTO_RESOLVED") continue;
      expect(decision.reason.length).toBeGreaterThan(10);
      expect(decision.recommendedAction.length).toBeGreaterThan(10);
      expect(decision.whyNotAutoResolved.length).toBeGreaterThan(30);
      expect(decision.exceptionType).not.toBeNull();
    }
  });

  it("leaves the why-not empty when it did resolve", () => {
    const clean = firstWithLabel("MATCHED");
    const decision = processRecord(clean);
    expect(decision.outcome).toBe("AUTO_RESOLVED");
    expect(decision.whyNotAutoResolved).toBe("");
  });

  it("traces every stage it ran", () => {
    const decision = processRecord(firstWithLabel("MATCHED"));
    expect(decision.trace.length).toBeGreaterThan(1);
    for (const stage of decision.trace) {
      expect(["DETERMINISTIC", "STATISTICAL", "POLICY"]).toContain(stage.kind);
    }
  });
});

describe("evaluation", () => {
  const report = evaluate(heldOut, {
    datasetVersion: "test",
    datasetSeed: DATASET_SEED,
    split: "HELD_OUT",
  });

  it("reports zero false resolutions", () => {
    expect(report.falseResolutions).toBe(0);
    expect(report.valueAtRiskFromFalseResolutionsPaise).toBe(0);
  });

  it("beats the exact-match baseline by a wide margin", () => {
    const baseline = evaluate(heldOut, {
      datasetVersion: "test",
      datasetSeed: DATASET_SEED,
      split: "HELD_OUT",
      useBaseline: true,
    });
    expect(report.matchRate).toBeGreaterThan(baseline.matchRate + 0.2);
  });

  it("accounts for every record as either reconciled or held", () => {
    // No record may silently disappear from the materiality totals.
    const accounted =
      report.exceptions.length +
      Math.round(report.autoResolutionRate * report.recordsProcessed);
    expect(accounted).toBe(report.recordsProcessed);
  });

  it("produces a non-empty exception list with actions", () => {
    expect(report.exceptions.length).toBeGreaterThan(0);
    for (const e of report.exceptions) {
      expect(e.recommendedAction.length).toBeGreaterThan(10);
      expect(e.amountPaise).toBeGreaterThanOrEqual(0);
    }
  });

  it("measures throughput", () => {
    expect(report.recordsPerSecond).toBeGreaterThan(0);
    expect(report.elapsedMs).toBeGreaterThan(0);
  });
});

describe("baseline", () => {
  it("is genuinely weaker, so the comparison is not rigged in our favour", () => {
    // The baseline must at least succeed on the trivial cases, or it is a
    // straw man and beating it proves nothing.
    const easyClean = records.filter(
      (r) => r.groundTruth.label === "MATCHED" && r.difficulty === "EASY"
    );
    const cleared = easyClean.filter(
      (r) => processRecordBaseline(r).outcome === "AUTO_RESOLVED"
    );
    expect(cleared.length).toBe(easyClean.length);
  });
});
