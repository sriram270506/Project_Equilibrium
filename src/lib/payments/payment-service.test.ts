import { describe, it, expect } from "vitest";
import { determinePaymentStatus, isTerminalStatus } from "./payment-service";

describe("Payment Service", () => {
  describe("determinePaymentStatus", () => {
    it("should return CONFIRMED when provider confirms success", () => {
      const status = determinePaymentStatus({
        providerResult: {
          status: "CONFIRMED",
          providerPaymentId: "pay_123",
        },
        operationTimeoutMs: 0,
      });

      expect(status).toBe("CONFIRMED");
    });

    it("should return FAILED when provider declines", () => {
      const status = determinePaymentStatus({
        providerResult: {
          status: "FAILED",
          reason: "Insufficient funds",
        },
        operationTimeoutMs: 0,
      });

      expect(status).toBe("FAILED");
    });

    it("should return UNKNOWN when operation times out after submission", () => {
      const status = determinePaymentStatus({
        providerResult: null,
        operationTimeoutMs: 5000, // Timed out
      });

      expect(status).toBe("UNKNOWN");
    });

    it("should return SUBMITTED when operation completes without provider response", () => {
      const status = determinePaymentStatus({
        providerResult: null,
        operationTimeoutMs: 0,
      });

      expect(status).toBe("SUBMITTED");
    });
  });

  describe("isTerminalStatus", () => {
    it("should identify CONFIRMED as terminal", () => {
      expect(isTerminalStatus("CONFIRMED")).toBe(true);
    });

    it("should identify FAILED as terminal", () => {
      expect(isTerminalStatus("FAILED")).toBe(true);
    });

    it("should identify REVERSED as terminal", () => {
      expect(isTerminalStatus("REVERSED")).toBe(true);
    });

    it("should identify MANUAL_REVIEW as terminal", () => {
      expect(isTerminalStatus("MANUAL_REVIEW")).toBe(true);
    });

    it("should identify UNKNOWN as non-terminal", () => {
      expect(isTerminalStatus("UNKNOWN")).toBe(false);
    });

    it("should identify SUBMITTED as non-terminal", () => {
      expect(isTerminalStatus("SUBMITTED")).toBe(false);
    });

    it("should identify ACKNOWLEDGED as non-terminal", () => {
      expect(isTerminalStatus("ACKNOWLEDGED")).toBe(false);
    });
  });
});
