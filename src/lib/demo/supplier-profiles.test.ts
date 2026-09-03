import { describe, it, expect } from "vitest";
import {
  SUPPLIER_PROFILES,
  generateObservations,
  OBSERVATION_DAYS,
} from "./supplier-profiles";

/**
 * The seed must be deterministic.
 *
 * A randomised seed is a reproducibility trap: a check passes on your machine
 * and fails on a reviewer's, and there is no way to tell whether the code
 * changed or the dice did. These tests pin that property so it cannot regress
 * quietly.
 */

const REFERENCE = new Date("2026-09-01T00:00:00.000Z");

describe("Demo seed determinism", () => {
  it("produces identical observations across runs for the same inputs", () => {
    const a = generateObservations(SUPPLIER_PROFILES[0], 1, REFERENCE);
    const b = generateObservations(SUPPLIER_PROFILES[0], 1, REFERENCE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces different data for different suppliers", () => {
    const a = generateObservations(SUPPLIER_PROFILES[0], 1, REFERENCE);
    const b = generateObservations(SUPPLIER_PROFILES[1], 2, REFERENCE);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("generates a full window of history per supplier", () => {
    for (const profile of SUPPLIER_PROFILES) {
      const observations = generateObservations(profile, 1, REFERENCE);
      expect(observations).toHaveLength(OBSERVATION_DAYS);
    }
  });

  it("never emits a negative or non-finite money amount", () => {
    for (let i = 0; i < SUPPLIER_PROFILES.length; i++) {
      for (const o of generateObservations(SUPPLIER_PROFILES[i], i + 1, REFERENCE)) {
        expect(Number.isFinite(o.availableBalancePaise)).toBe(true);
        expect(o.availableBalancePaise).toBeGreaterThanOrEqual(0);
        expect(o.outflowPaise).toBeGreaterThan(0);
        expect(o.inflowPaise).toBeGreaterThanOrEqual(0);
        expect(o.daysRunway).toBeGreaterThan(0);
      }
    }
  });

  it("keeps rates inside their valid ranges", () => {
    for (let i = 0; i < SUPPLIER_PROFILES.length; i++) {
      for (const o of generateObservations(SUPPLIER_PROFILES[i], i + 1, REFERENCE)) {
        expect(o.paymentRegularity).toBeGreaterThan(0);
        expect(o.paymentRegularity).toBeLessThanOrEqual(1);
        expect(o.volatility).toBeGreaterThan(0);
        expect(o.volatility).toBeLessThanOrEqual(1);
      }
    }
  });

  it("makes deteriorating suppliers actually deteriorate", () => {
    const declining = SUPPLIER_PROFILES.filter((p) => p.shape.deteriorating);
    expect(declining.length).toBeGreaterThan(0);

    for (const profile of declining) {
      const observations = generateObservations(profile, 1, REFERENCE);
      const firstWeek =
        observations.slice(0, 7).reduce((s, o) => s + o.daysRunway, 0) / 7;
      const lastWeek =
        observations.slice(-7).reduce((s, o) => s + o.daysRunway, 0) / 7;

      expect(lastWeek).toBeLessThan(firstWeek);
    }
  });

  it("covers a genuine spread of risk, not one uniform cohort", () => {
    const distressed = SUPPLIER_PROFILES.filter(
      (p) => p.shape.endingRunwayDays < 7
    );
    const healthy = SUPPLIER_PROFILES.filter(
      (p) => p.shape.endingRunwayDays >= 12
    );

    expect(SUPPLIER_PROFILES.length).toBeGreaterThanOrEqual(10);
    expect(distressed.length).toBeGreaterThanOrEqual(3);
    expect(healthy.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every supplier a distinct identity", () => {
    const names = new Set(SUPPLIER_PROFILES.map((p) => p.name));
    const emails = new Set(SUPPLIER_PROFILES.map((p) => p.email));
    expect(names.size).toBe(SUPPLIER_PROFILES.length);
    expect(emails.size).toBe(SUPPLIER_PROFILES.length);
  });
});
