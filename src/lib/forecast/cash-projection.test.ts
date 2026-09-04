import { describe, it, expect } from "vitest";
import {
  projectCash,
  compareWithIntervention,
  projectionInputFromObservation,
  ProjectionInput,
} from "./cash-projection";

/** A supplier heading for a wall: outflow exceeds expected receipts. */
const DISTRESSED: ProjectionInput = {
  openingBalancePaise: 1_50_000_00,
  dailyOutflowPaise: 62_000_00,
  dailyInflowPaise: 60_000_00,
  paymentRegularity: 0.55,
  volatility: 0.31,
  seed: 7,
};

/** Comfortable: receipts arrive reliably and cover costs. */
const HEALTHY: ProjectionInput = {
  openingBalancePaise: 20_00_000_00,
  dailyOutflowPaise: 50_000_00,
  dailyInflowPaise: 62_000_00,
  paymentRegularity: 0.93,
  volatility: 0.09,
  seed: 7,
};

describe("Cash projection", () => {
  it("is deterministic for a given seed", () => {
    const a = projectCash(DISTRESSED);
    const b = projectCash(DISTRESSED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a point for every day of the horizon", () => {
    const p = projectCash({ ...DISTRESSED, horizonDays: 21 });
    expect(p.days).toHaveLength(21);
    expect(p.days[0].day).toBe(1);
    expect(p.days[20].day).toBe(21);
  });

  it("keeps the percentile band correctly ordered", () => {
    for (const d of projectCash(DISTRESSED).days) {
      expect(d.p10Paise).toBeLessThanOrEqual(d.medianPaise);
      expect(d.medianPaise).toBeLessThanOrEqual(d.p90Paise);
    }
  });

  it("finds a zero crossing for a supplier that runs out", () => {
    const p = projectCash(DISTRESSED);
    expect(p.medianZeroCrossingDay).not.toBeNull();
    expect(p.medianZeroCrossingDay!).toBeGreaterThan(0);
    expect(p.medianZeroCrossingDay!).toBeLessThanOrEqual(p.horizonDays);
    expect(p.shortfallProbability).toBeGreaterThan(0.5);
  });

  it("finds no crossing for a healthy supplier", () => {
    const p = projectCash(HEALTHY);
    expect(p.medianZeroCrossingDay).toBeNull();
    expect(p.worstMedianDeficitPaise).toBe(0);
    expect(p.shortfallProbability).toBeLessThan(0.2);
  });

  it("flags risk before the median actually crosses", () => {
    // The pessimistic tail should sound the alarm earlier than the midpoint.
    const p = projectCash(DISTRESSED);
    expect(p.earliestRiskDay).not.toBeNull();
    expect(p.earliestRiskDay!).toBeLessThanOrEqual(p.medianZeroCrossingDay!);
  });

  it("widens the band as the horizon extends", () => {
    const p = projectCash({ ...DISTRESSED, horizonDays: 21 });
    const early = p.days[1].p90Paise - p.days[1].p10Paise;
    const late = p.days[20].p90Paise - p.days[20].p10Paise;
    // Uncertainty compounds; a forecast that stayed equally confident at three
    // weeks as at two days would be lying.
    expect(late).toBeGreaterThan(early);
  });

  it("reports how much cash would close the gap", () => {
    const p = projectCash(DISTRESSED);
    expect(p.cashNeededPaise).toBeGreaterThan(0);
    expect(p.cashNeededPaise).toBe(p.worstMedianDeficitPaise);
  });
});

describe("Intervention comparison", () => {
  it("compares both paths on the SAME seed", () => {
    const c = compareWithIntervention(DISTRESSED, 5_00_000_00);
    // With an identical seed and a zero advance, the two runs must be identical.
    const zero = compareWithIntervention(DISTRESSED, 0);
    expect(JSON.stringify(zero.baseline)).toBe(
      JSON.stringify(zero.withAdvance)
    );
    expect(c.baseline.days).toHaveLength(c.withAdvance.days.length);
  });

  it("buys runway proportional to the advance", () => {
    const small = compareWithIntervention(DISTRESSED, 1_00_000_00);
    const large = compareWithIntervention(DISTRESSED, 8_00_000_00);
    expect(large.runwayDaysGained).toBeGreaterThanOrEqual(
      small.runwayDaysGained
    );
  });

  it("averts the shortfall when the advance is large enough", () => {
    const c = compareWithIntervention(DISTRESSED, 20_00_000_00);
    expect(c.shortfallAverted).toBe(true);
    expect(c.withAdvance.medianZeroCrossingDay).toBeNull();
    expect(c.riskReductionPoints).toBeGreaterThan(0);
  });

  it("does not claim an effect when the advance is trivial", () => {
    const c = compareWithIntervention(DISTRESSED, 100);
    expect(c.runwayDaysGained).toBe(0);
    expect(c.shortfallAverted).toBe(false);
  });

  it("lifts every point on the curve by the advance", () => {
    const c = compareWithIntervention(DISTRESSED, 5_00_000_00);
    for (let i = 0; i < c.baseline.days.length; i++) {
      expect(c.withAdvance.days[i].medianPaise).toBeGreaterThan(
        c.baseline.days[i].medianPaise
      );
    }
  });
});

describe("Observation mapping", () => {
  it("does not scale inflow by regularity twice", () => {
    const input = projectionInputFromObservation({
      availableBalancePaise: 5_00_000_00,
      inflowPaise: 60_000_00,
      outflowPaise: 50_000_00,
      paymentRegularity: 0.5,
      volatility: 0.2,
    });
    // The stored inflow is the amount that arrives ON a paying day. The
    // simulation applies regularity as an arrival probability, so scaling here
    // as well would halve receipts twice over.
    expect(input.dailyInflowPaise).toBe(60_000_00);
    expect(input.paymentRegularity).toBe(0.5);
  });
});
