import { describe, it, expect } from "vitest";
import {
  detectReconciliationIssue,
} from "./reconciliation-service";

describe("Reconciliation Service", () => {
  describe("detectReconciliationIssue", () => {
    it("should return MATCHED when internal and external are identical", () => {
      const result = detectReconciliationIssue({
        internalStatus: "CONFIRMED",
        externalStatus: "CONFIRMED",
        internalAmountPaise: 100000,
        externalAmountPaise: 100000,
      });

      expect(result.outcome).toBe("MATCHED");
      expect(result.issue).toBeNull();
    });

    it("should detect AMOUNT_MISMATCH", () => {
      const result = detectReconciliationIssue({
        internalStatus: "CONFIRMED",
        externalStatus: "CONFIRMED",
        internalAmountPaise: 100000,
        externalAmountPaise: 100001, // Different amount
      });

      expect(result.outcome).toBe("AMOUNT_MISMATCH");
      expect(result.issue).toContain("amount");
    });

    it("should detect STATUS_MISMATCH", () => {
      const result = detectReconciliationIssue({
        internalStatus: "UNKNOWN",
        externalStatus: "CONFIRMED",
        internalAmountPaise: 100000,
        externalAmountPaise: 100000,
      });

      expect(result.outcome).toBe("STATUS_MISMATCH");
      expect(result.issue).toContain("status");
    });

    it("should detect MISSING_EXTERNAL when external has no status", () => {
      const result = detectReconciliationIssue({
        internalStatus: "CONFIRMED",
        externalStatus: null,
        internalAmountPaise: 100000,
        externalAmountPaise: null,
      });

      expect(result.outcome).toBe("MISSING_EXTERNAL");
    });

    it("should detect MISSING_INTERNAL when internal has no status", () => {
      const result = detectReconciliationIssue({
        internalStatus: null,
        externalStatus: "CONFIRMED",
        internalAmountPaise: null,
        externalAmountPaise: 100000,
      });

      expect(result.outcome).toBe("MISSING_INTERNAL");
    });

    it("should prioritize AMOUNT_MISMATCH over STATUS_MISMATCH", () => {
      const result = detectReconciliationIssue({
        internalStatus: "CONFIRMED",
        externalStatus: "UNKNOWN", // Status mismatch
        internalAmountPaise: 100000,
        externalAmountPaise: 100001, // Amount mismatch
      });

      expect(result.outcome).toBe("AMOUNT_MISMATCH");
    });

    it("should handle UNKNOWN to CONFIRMED resolution", () => {
      const result = detectReconciliationIssue({
        internalStatus: "UNKNOWN",
        externalStatus: "CONFIRMED",
        internalAmountPaise: 100000,
        externalAmountPaise: 100000,
      });

      // UNKNOWN can be resolved by external confirmation
      expect(result.outcome).toBe("STATUS_MISMATCH");
      expect(result.canResolveAutomatically).toBe(true);
    });
  });
});
