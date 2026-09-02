import { describe, it, expect } from "vitest";
import { generateRequestFingerprint, generateIdempotencyKey } from "./idempotency";

describe("Idempotency", () => {
  describe("generateRequestFingerprint", () => {
    it("should generate consistent fingerprint for same payload", () => {
      const payload = {
        supplier_id: "supp_123",
        amount_paise: 150000,
        discount_bps: 120,
      };

      const fingerprint1 = generateRequestFingerprint(payload);
      const fingerprint2 = generateRequestFingerprint(payload);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it("should generate different fingerprint for different payloads", () => {
      const payload1 = {
        supplier_id: "supp_123",
        amount_paise: 150000,
        discount_bps: 120,
      };

      const payload2 = {
        supplier_id: "supp_123",
        amount_paise: 150001, // Different amount
        discount_bps: 120,
      };

      const fingerprint1 = generateRequestFingerprint(payload1);
      const fingerprint2 = generateRequestFingerprint(payload2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should be order-independent", () => {
      const payload1 = { a: 1, b: 2, c: 3 };
      const payload2 = { c: 3, a: 1, b: 2 }; // Different order

      const fingerprint1 = generateRequestFingerprint(payload1);
      const fingerprint2 = generateRequestFingerprint(payload2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it("should return hex string", () => {
      const payload = { test: "data" };
      const fingerprint = generateRequestFingerprint(payload);

      expect(typeof fingerprint).toBe("string");
      expect(/^[a-f0-9]{64}$/.test(fingerprint)).toBe(true); // SHA256 hex
    });
  });

  describe("generateIdempotencyKey", () => {
    it("should generate key with idem_ prefix", () => {
      const key = generateIdempotencyKey();
      expect(key).toMatch(/^idem_/);
    });

    it("should generate unique keys", () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();

      expect(key1).not.toBe(key2);
    });

    it("should include UUID format", () => {
      const key = generateIdempotencyKey();
      const uuidPart = key.replace("idem_", "");

      // UUID format check (basic)
      expect(uuidPart.length).toBeGreaterThan(0);
      expect(uuidPart).not.toContain(" ");
    });
  });
});
