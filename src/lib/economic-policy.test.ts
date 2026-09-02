import { describe, it, expect } from "vitest";
import {
  evaluateOpportunity,
  DEFAULT_MAX_DISCOUNT_PERCENTAGE,
  DEFAULT_EXPECTED_VALUE_MULTIPLIER,
} from "./economic-policy";

describe("Economic Policy", () => {
  describe("evaluateOpportunity", () => {
    it("should reject when discount exceeds max", () => {
      const result = evaluateOpportunity({
        amountPaise: 100000,
        recommendedDiscountBps: 2000, // 20% - exceeds default max
        modelProbability: 0.8,
        riskTier: "TIER_1",
      });

      expect(result.decision).toBe("REJECT");
      expect(result.reason).toContain("exceeds maximum");
    });

    it("should approve low-risk opportunity", () => {
      const result = evaluateOpportunity({
        amountPaise: 100000,
        recommendedDiscountBps: 500, // 5%
        modelProbability: 0.8,
        riskTier: "TIER_1",
      });

      expect(result.decision).toBe("APPROVE");
      expect(result.expectedValuePaise).toBeGreaterThan(0);
    });

    it("should calculate expected benefit correctly", () => {
      const amountPaise = 100000;
      const discountBps = 500; // 5% = 5000 paise
      
      const result = evaluateOpportunity({
        amountPaise,
        recommendedDiscountBps: discountBps,
        modelProbability: 1.0, // Certain
        riskTier: "TIER_1",
      });

      // Benefit = discount amount * multiplier
      const expectedBenefit = Math.round(5000 * DEFAULT_EXPECTED_VALUE_MULTIPLIER);
      expect(result.expectedBenefitPaise).toBe(expectedBenefit);
    });

    it("should apply risk tier adjustment", () => {
      const baseResult = evaluateOpportunity({
        amountPaise: 100000,
        recommendedDiscountBps: 500,
        modelProbability: 0.5,
        riskTier: "TIER_1",
      });

      const riskierResult = evaluateOpportunity({
        amountPaise: 100000,
        recommendedDiscountBps: 500,
        modelProbability: 0.5,
        riskTier: "TIER_3",
      });

      // Higher risk should result in lower or equal expected value
      expect(riskierResult.expectedValuePaise).toBeLessThanOrEqual(
        baseResult.expectedValuePaise
      );
    });

    it("should set max allowed discount based on amount", () => {
      const result = evaluateOpportunity({
        amountPaise: 100000,
        recommendedDiscountBps: 100,
        modelProbability: 0.8,
        riskTier: "TIER_1",
      });

      const expectedMaxDiscount = Math.round(
        100000 * (DEFAULT_MAX_DISCOUNT_PERCENTAGE / 100)
      );
      expect(result.maxAllowedDiscountPaise).toBe(expectedMaxDiscount);
    });

    it("should handle zero probability", () => {
      const result = evaluateOpportunity({
        amountPaise: 100000,
        recommendedDiscountBps: 500,
        modelProbability: 0.0,
        riskTier: "TIER_1",
      });

      expect(result.expectedValuePaise).toBeLessThanOrEqual(0);
    });
  });
});
