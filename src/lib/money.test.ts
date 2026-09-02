import { describe, it, expect } from "vitest";
import { formatPaise, addPaise, subtractPaise, multiplyPaise } from "./money";

describe("Money utilities", () => {
  describe("formatPaise", () => {
    it("should format paise to rupees display", () => {
      expect(formatPaise(0)).toBe("₹0.00");
      expect(formatPaise(100)).toBe("₹1.00");
      expect(formatPaise(150000)).toBe("₹1,500.00");
      expect(formatPaise(1000000)).toBe("₹10,000.00");
    });

    it("should handle large numbers with comma separation", () => {
      expect(formatPaise(123456789)).toBe("₹1,234,567.89");
    });

    it("should handle edge case of 1 paise", () => {
      expect(formatPaise(1)).toBe("₹0.01");
    });
  });

  describe("addPaise", () => {
    it("should add two amounts in paise", () => {
      expect(addPaise(100, 200)).toBe(300);
      expect(addPaise(150000, 50000)).toBe(200000);
    });

    it("should handle zero", () => {
      expect(addPaise(0, 100)).toBe(100);
      expect(addPaise(100, 0)).toBe(100);
    });

    it("should return integer result", () => {
      const result = addPaise(100, 200);
      expect(result).toStrictEqual(300);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe("subtractPaise", () => {
    it("should subtract two amounts in paise", () => {
      expect(subtractPaise(300, 100)).toBe(200);
      expect(subtractPaise(200000, 50000)).toBe(150000);
    });

    it("should handle zero", () => {
      expect(subtractPaise(100, 0)).toBe(100);
      expect(subtractPaise(0, 100)).toBe(-100);
    });

    it("should return integer result", () => {
      const result = subtractPaise(300, 100);
      expect(result).toStrictEqual(200);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe("multiplyPaise", () => {
    it("should multiply paise by a factor", () => {
      expect(multiplyPaise(100, 2)).toBe(200);
      expect(multiplyPaise(50000, 3)).toBe(150000);
    });

    it("should handle decimal factors (basis points)", () => {
      // 120 basis points = 0.012
      expect(multiplyPaise(100000, 0.012)).toBe(1200);
      // 50 basis points = 0.005
      expect(multiplyPaise(100000, 0.005)).toBe(500);
    });

    it("should round to nearest integer", () => {
      const result = multiplyPaise(100, 1.5);
      expect(result).toStrictEqual(150);
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should handle zero", () => {
      expect(multiplyPaise(100, 0)).toBe(0);
      expect(multiplyPaise(0, 5)).toBe(0);
    });
  });
});
