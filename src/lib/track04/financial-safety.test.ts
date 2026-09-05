import { describe, it, expect } from "vitest";
import { buildDataset, DATASET_SEED } from "./dataset";
import { evaluate } from "./evaluate";

/**
 * The safety counters, checked for the property that makes them worth
 * printing: they must be capable of being non-zero.
 *
 * A panel of zeros is only meaningful if the zeros could have been something
 * else. The database-backed counters are exercised against the live API in the
 * browser; these cover the benchmark-derived ones, where a deliberately broken
 * input can be fed in and the counter must notice.
 */

const heldOut = buildDataset(DATASET_SEED).filter(
  (r) => r.split === "HELD_OUT"
);

describe("safety counters can fail", () => {
  it("reports false resolutions when the ground truth is inverted", () => {
    /*
     * Flip every escalation to "should have been cleared". The controller
     * still escalates them, so a counter that works must now report a large
     * number of MISSED matches - and if it reported zero, it would not be
     * measuring anything about the controller at all.
     */
    const inverted = heldOut.map((r) => ({
      ...r,
      groundTruth: {
        ...r.groundTruth,
        expectedAction: "AUTO_RESOLVE" as const,
        expectedMatchExternalId: r.externals[0]?.id ?? null,
      },
    }));

    const report = evaluate(inverted, {
      datasetVersion: "inverted",
      datasetSeed: DATASET_SEED,
      split: "HELD_OUT",
    });

    expect(report.missedMatches).toBeGreaterThan(0);
    expect(report.matchRate).toBeLessThan(1);
  });

  it("reports a false resolution when a clean record is relabelled unsafe", () => {
    // Take records the controller clears and declare they needed a human.
    // The counter must now see them as cleared-when-it-should-not-have-been.
    const poisoned = heldOut.map((r) =>
      r.groundTruth.label === "MATCHED"
        ? {
            ...r,
            groundTruth: {
              ...r.groundTruth,
              expectedAction: "ESCALATE" as const,
              expectedMatchExternalId: null,
            },
          }
        : r
    );

    const report = evaluate(poisoned, {
      datasetVersion: "poisoned",
      datasetSeed: DATASET_SEED,
      split: "HELD_OUT",
    });

    expect(report.falseResolutions).toBeGreaterThan(0);
    expect(report.valueAtRiskFromFalseResolutionsPaise).toBeGreaterThan(0);
  });

  it("reports zero on the real dataset", () => {
    // Having shown the counter can fire, the honest baseline.
    const report = evaluate(heldOut, {
      datasetVersion: "real",
      datasetSeed: DATASET_SEED,
      split: "HELD_OUT",
    });
    expect(report.falseResolutions).toBe(0);
  });

  it("prices duplicates separately from every other defect", () => {
    const report = evaluate(heldOut, {
      datasetVersion: "real",
      datasetSeed: DATASET_SEED,
      split: "HELD_OUT",
    });
    // A duplicate that slips through is money already gone twice, so it gets
    // its own counter rather than being folded into a general accuracy figure.
    expect(report.duplicatePaymentsPrevented).toBeGreaterThan(0);
    expect(report.duplicateResolutionRate).toBe(1);
  });
});
