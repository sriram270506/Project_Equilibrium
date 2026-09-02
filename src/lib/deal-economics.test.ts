import { describe, it, expect } from "vitest";
import {
  computeDealEconomics,
  describeDeal,
  isFairToSupplier,
  DEFAULT_ALTERNATIVE_FUNDING_RATE_BPS,
} from "./deal-economics";

describe("Deal economics", () => {
  it("splits face value into what the supplier gets and what the platform earns", () => {
    const deal = computeDealEconomics({
      faceValuePaise: 15000000, // Rs 1,50,000
      daysEarly: 27,
      discountBps: 120, // 1.2%
    });

    expect(deal.discountPaise).toBe(180000); // Rs 1,800
    expect(deal.supplierReceivesPaise).toBe(14820000); // Rs 1,48,200
    expect(deal.platformEarnsPaise).toBe(180000);
    // Nothing is created or destroyed.
    expect(deal.supplierReceivesPaise + deal.discountPaise).toBe(
      deal.faceValuePaise
    );
  });

  it("annualizes the discount so a short-dated rate cannot look cheap", () => {
    const deal = computeDealEconomics({
      faceValuePaise: 15000000,
      daysEarly: 27,
      discountBps: 120,
    });

    // 1.2% over 27 days is roughly 16.2% annualized, not 1.2%.
    expect(deal.annualizedRateBps).toBe(1622);
    expect(deal.annualizedRatePercent).toBeCloseTo(16.22, 1);
  });

  it("charges more, annualized, when the money is advanced for fewer days", () => {
    const long = computeDealEconomics({
      faceValuePaise: 10000000,
      daysEarly: 60,
      discountBps: 120,
    });
    const short = computeDealEconomics({
      faceValuePaise: 10000000,
      daysEarly: 5,
      discountBps: 120,
    });

    expect(short.annualizedRateBps).toBeGreaterThan(long.annualizedRateBps);
  });

  it("nets the platform's own cost of capital out of the margin", () => {
    const deal = computeDealEconomics({
      faceValuePaise: 15000000,
      daysEarly: 27,
      discountBps: 120,
      platformCostOfCapitalBps: 800,
    });

    expect(deal.platformCostOfCapitalPaise).toBeGreaterThan(0);
    expect(deal.netPlatformMarginPaise).toBe(
      deal.platformEarnsPaise - deal.platformCostOfCapitalPaise
    );
    expect(deal.netPlatformMarginPaise).toBeLessThan(deal.platformEarnsPaise);
  });

  it("shows the supplier saving money versus borrowing at 24%", () => {
    const deal = computeDealEconomics({
      faceValuePaise: 15000000,
      daysEarly: 27,
      discountBps: 120,
    });

    expect(deal.supplierSavingsVsAlternativePaise).toBeGreaterThan(0);
    expect(deal.alternativeFundingRateBps).toBe(
      DEFAULT_ALTERNATIVE_FUNDING_RATE_BPS
    );
  });

  it("flags a deal as unfair once it prices above the supplier's alternative", () => {
    const fair = computeDealEconomics({
      faceValuePaise: 15000000,
      daysEarly: 27,
      discountBps: 120,
    });
    const gouging = computeDealEconomics({
      faceValuePaise: 15000000,
      daysEarly: 5,
      discountBps: 120, // 1.2% over 5 days = ~87% annualized
    });

    expect(isFairToSupplier(fair)).toBe(true);
    expect(isFairToSupplier(gouging)).toBe(false);
  });

  it("handles a same-day advance without dividing by zero", () => {
    const deal = computeDealEconomics({
      faceValuePaise: 10000000,
      daysEarly: 0,
      discountBps: 100,
    });

    expect(deal.annualizedRateBps).toBe(0);
    expect(deal.platformCostOfCapitalPaise).toBe(0);
  });

  it("rejects invalid inputs rather than silently producing bad money", () => {
    expect(() =>
      computeDealEconomics({
        faceValuePaise: -100,
        daysEarly: 10,
        discountBps: 100,
      })
    ).toThrow(/Invalid face value/);

    expect(() =>
      computeDealEconomics({
        faceValuePaise: 10000,
        daysEarly: -1,
        discountBps: 100,
      })
    ).toThrow(/negative/);
  });

  it("describes the trade in one sentence for the demo narration", () => {
    const deal = computeDealEconomics({
      faceValuePaise: 15000000,
      daysEarly: 27,
      discountBps: 120,
    });

    const sentence = describeDeal(deal);
    expect(sentence).toContain("1,48,200");
    expect(sentence).toContain("27 days");
    expect(sentence).toContain("16.2%");
  });
});
