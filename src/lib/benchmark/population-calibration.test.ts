import { describe, it, expect } from "vitest";
import {
  probit,
  normalCdf,
  TURNOVER_FIT,
  MEAN_COLLECTION_EFFICIENCY,
  COLLECTION_EFFICIENCY_CONCENTRATION,
  FIRM_SIZE,
  PAYMENT_BEHAVIOUR,
  KNOWN_DIVERGENCES,
  calibrationReport,
} from "./population-calibration";

/**
 * These tests exist because "calibrated to published data" is a claim, and a
 * claim nobody checks is a decoration. Each test re-derives a published figure
 * from the fitted parameters, so if someone edits a constant to make a demo
 * look better, the arithmetic stops agreeing with the citation and this fails.
 */

describe("probit", () => {
  it("matches known standard normal quantiles", () => {
    expect(probit(0.5)).toBeCloseTo(0, 6);
    expect(probit(0.975)).toBeCloseTo(1.959964, 4);
    expect(probit(0.025)).toBeCloseTo(-1.959964, 4);
    expect(probit(0.99)).toBeCloseTo(2.326348, 4);
  });

  it("is the inverse of the normal CDF", () => {
    for (const p of [0.01, 0.1, 0.35, 0.5, 0.88, 0.989, 0.999]) {
      expect(normalCdf(probit(p))).toBeCloseTo(p, 4);
    }
  });

  it("refuses probabilities outside the open unit interval", () => {
    expect(() => probit(0)).toThrow();
    expect(() => probit(1)).toThrow();
  });
});

describe("turnover distribution", () => {
  it("reproduces both published quantiles it was solved from", () => {
    const pUnderOneCrore = normalCdf(
      (Math.log(FIRM_SIZE.oneCroreRupees.value) - TURNOVER_FIT.logMean) /
        TURNOVER_FIT.logSd
    );
    const pUnderTenCrore = normalCdf(
      (Math.log(FIRM_SIZE.microTurnoverCeilingRupees.value) -
        TURNOVER_FIT.logMean) /
        TURNOVER_FIT.logSd
    );

    expect(pUnderOneCrore).toBeCloseTo(
      FIRM_SIZE.shareUnderOneCroreTurnover.value,
      3
    );
    expect(pUnderTenCrore).toBeCloseTo(FIRM_SIZE.shareMicro.value, 3);
  });

  it("puts the median firm well below the Rs 1 crore threshold", () => {
    // 88% sit below Rs 1 crore, so the median must be far under it. A fit that
    // produced a median near the threshold would be arithmetically wrong.
    const median = Math.exp(TURNOVER_FIT.logMean);
    expect(median).toBeLessThan(FIRM_SIZE.oneCroreRupees.value);
    expect(median).toBeGreaterThan(0);
  });
});

describe("collection efficiency", () => {
  it("solves the Beta mean so E[days] equals the published average", () => {
    // The whole point of the closed form: E[1/p] = (k-1)/(mk-1), so the
    // implied average realised cycle must come back to the published 73 days.
    const k = COLLECTION_EFFICIENCY_CONCENTRATION;
    const a = MEAN_COLLECTION_EFFICIENCY * k;
    const impliedDays =
      PAYMENT_BEHAVIOUR.modalCreditDays.value * ((k - 1) / (a - 1));

    expect(impliedDays).toBeCloseTo(
      PAYMENT_BEHAVIOUR.averageRealisedDays.value,
      6
    );
  });

  it("is NOT the naive terms/days ratio", () => {
    /*
     * Guards the Jensen correction. Anchoring the mean efficiency at 30/73
     * produces a population averaging 98.6 days, not 73. If someone
     * "simplifies" the fit back to the ratio, this test explains why not.
     */
    const naive =
      PAYMENT_BEHAVIOUR.modalCreditDays.value /
      PAYMENT_BEHAVIOUR.averageRealisedDays.value;

    expect(MEAN_COLLECTION_EFFICIENCY).toBeGreaterThan(naive);
    expect(naive).toBeCloseTo(0.411, 3);
    expect(MEAN_COLLECTION_EFFICIENCY).toBeCloseTo(0.509, 3);
  });

  it("keeps the Beta shape above 1 so E[1/p] stays finite", () => {
    expect(
      MEAN_COLLECTION_EFFICIENCY * COLLECTION_EFFICIENCY_CONCENTRATION
    ).toBeGreaterThan(1);
  });
});

describe("calibrationReport", () => {
  it("passes for a population built to the fitted parameters", () => {
    const population = Array.from({ length: 2000 }, (_, i) => ({
      // Deterministic spread around the fitted mean, standing in for a draw.
      collectionEfficiency:
        MEAN_COLLECTION_EFFICIENCY *
        (0.6 + 0.8 * ((i % 100) / 99)),
      annualTurnoverRupees: Math.exp(
        TURNOVER_FIT.logMean + TURNOVER_FIT.logSd * ((i % 7) - 3) * 0.4
      ),
    }));

    const checks = calibrationReport(population);
    expect(checks.length).toBeGreaterThan(0);
    // The efficiency check is the one this synthetic stand-in is built to hit.
    const efficiencyCheck = checks.find((c) =>
      c.statistic.includes("Mean collection efficiency")
    );
    expect(efficiencyCheck?.passed).toBe(true);
  });

  it("fails loudly rather than silently on an empty population", () => {
    expect(() => calibrationReport([])).toThrow(/empty population/i);
  });

  it("detects a population that drifted off its anchor", () => {
    const drifted = Array.from({ length: 500 }, () => ({
      collectionEfficiency: 0.95, // everyone pays on time - not this market
      annualTurnoverRupees: 5_00_000,
    }));

    const checks = calibrationReport(drifted);
    expect(checks.some((c) => !c.passed)).toBe(true);
  });
});

describe("known divergences", () => {
  it("records where the calibration disagrees with published figures", () => {
    // A calibration that agrees with everything has been tuned, not fitted.
    expect(KNOWN_DIVERGENCES.length).toBeGreaterThan(0);
    for (const divergence of KNOWN_DIVERGENCES) {
      expect(divergence.explanation.length).toBeGreaterThan(40);
      expect(divergence.published).toBeTruthy();
    }
  });
});
