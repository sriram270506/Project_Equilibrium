import { describe, it, expect } from "vitest";
import {
  benchmarkRate,
  msmedPenaltyPaise,
  marketSnapshot,
  TREDS,
  MSME_DELAYED_PAYMENTS,
  ALTERNATIVE_CREDIT_BPS,
} from "./market-data";

describe("Rate benchmarking against TReDS", () => {
  it("reports honestly when we are dearer than the incumbent", () => {
    // 16.2% is the rate the demo actually charges. It IS above TReDS, and the
    // benchmark must say so rather than flattering the product.
    const b = benchmarkRate(1622);
    expect(b.verdict).toBe("ABOVE_TREDS");
    expect(b.assessment).toContain("dearer than TReDS");
    expect(b.justification).toContain("access");
    expect(b.vsTredsMidpointBps).toBeGreaterThan(0);
  });

  it("recognises a competitive rate inside the band", () => {
    const b = benchmarkRate(1000);
    expect(b.verdict).toBe("WITHIN_TREDS_BAND");
    expect(b.vsTredsMidpointBps).toBe(0);
  });

  it("recognises undercutting the band", () => {
    const b = benchmarkRate(600);
    expect(b.verdict).toBe("BELOW_TREDS");
    expect(b.vsTredsMidpointBps).toBeLessThan(0);
  });

  it("refuses to defend a rate above the supplier's own credit alternative", () => {
    const b = benchmarkRate(ALTERNATIVE_CREDIT_BPS + 100);
    expect(b.verdict).toBe("ABOVE_ALTERNATIVE_CREDIT");
    expect(b.justification).toContain("Not defensible");
  });

  it("puts the band boundaries in the right order", () => {
    const b = benchmarkRate(1000);
    expect(b.tredsLowBps).toBeLessThan(b.tredsHighBps);
    expect(b.tredsHighBps).toBeLessThan(b.alternativeCreditBps);
  });
});

describe("MSMED statutory penalty", () => {
  it("is zero when payment is on time", () => {
    expect(msmedPenaltyPaise(10_00_000_00, 0)).toBe(0);
    expect(msmedPenaltyPaise(10_00_000_00, -5)).toBe(0);
  });

  it("compounds with the length of the delay", () => {
    const short = msmedPenaltyPaise(10_00_000_00, 30);
    const long = msmedPenaltyPaise(10_00_000_00, 180);
    expect(long).toBeGreaterThan(short * 5);
  });

  it("scales with the principal", () => {
    const small = msmedPenaltyPaise(1_00_000_00, 90);
    const large = msmedPenaltyPaise(10_00_000_00, 90);
    expect(large).toBeCloseTo(small * 10, -2);
  });

  it("uses three times the bank rate, as the Act requires", () => {
    expect(MSME_DELAYED_PAYMENTS.penaltyMultipleOfBankRate.value).toBe(3);
    // 45 days late on Rs 5,00,000 at a 6.5% bank rate is a real, non-trivial
    // number - the point being that late payment is not free.
    const penalty = msmedPenaltyPaise(5_00_000_00, 45, 650);
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(5_00_000_00);
  });
});

describe("Market data provenance", () => {
  it("cites a source and an as-of date for every figure", () => {
    const figures = [
      MSME_DELAYED_PAYMENTS.applicationsFiled,
      MSME_DELAYED_PAYMENTS.amountPendingCrore,
      MSME_DELAYED_PAYMENTS.statutoryPaymentDays,
      TREDS.volumeFy26Crore,
      TREDS.registeredMsmes,
    ];
    for (const f of figures) {
      expect(f.source.length).toBeGreaterThan(3);
      expect(f.url).toMatch(/^https?:\/\//);
      expect(f.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.label.length).toBeGreaterThan(10);
    }
  });

  it("records the statutory 45-day limit", () => {
    expect(MSME_DELAYED_PAYMENTS.statutoryPaymentDays.value).toBe(45);
  });

  it("computes TReDS growth from the two reported years", () => {
    const snapshot = marketSnapshot();
    // Roughly 8.7x between FY22 and FY26.
    expect(snapshot.incumbent.growthMultiple).toBeGreaterThan(5);
    expect(snapshot.incumbent.platforms.value).toHaveLength(5);
  });
});
