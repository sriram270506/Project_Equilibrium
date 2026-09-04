import { describe, it, expect } from "vitest";
import {
  sanitizeFileName,
  detectMagicBytesMime,
  validateUploadedFile,
  UploadValidationError,
} from "./hardening";

describe("Upload Hardening", () => {
  describe("sanitizeFileName", () => {
    it("should clean standard filenames", () => {
      expect(sanitizeFileName("invoice.pdf")).toBe("invoice.pdf");
      expect(sanitizeFileName("my_receipt_2026.png")).toBe("my_receipt_2026.png");
    });

    it("should strip path traversal vectors", () => {
      expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
      expect(sanitizeFileName("..\\..\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
    });

    it("should strip null bytes and unsafe characters", () => {
      expect(sanitizeFileName("evil\0.pdf")).toBe("evil.pdf");
      expect(sanitizeFileName("test<script>alert(1).png")).toBe("test_script_alert_1_.png");
    });
  });

  describe("detectMagicBytesMime", () => {
    it("should detect PDF magic bytes", () => {
      const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      expect(detectMagicBytesMime(pdfHeader)).toBe("application/pdf");
    });

    it("should detect PNG magic bytes", () => {
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectMagicBytesMime(pngHeader)).toBe("image/png");
    });

    it("should detect JPEG magic bytes", () => {
      const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(detectMagicBytesMime(jpegHeader)).toBe("image/jpeg");
    });

    it("should return null for executable or unknown bytes", () => {
      const exeHeader = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ header
      expect(detectMagicBytesMime(exeHeader)).toBeNull();
    });
  });

  describe("validateUploadedFile", () => {
    const validPdfBuffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const validPngBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    it("should pass valid PDF uploads", () => {
      const res = validateUploadedFile(validPdfBuffer, "invoice.pdf", "application/pdf");
      expect(res.sanitizedFileName).toBe("invoice.pdf");
      expect(res.mimeType).toBe("application/pdf");
    });

    it("should reject empty files", () => {
      expect(() =>
        validateUploadedFile(new Uint8Array(0), "empty.pdf", "application/pdf")
      ).toThrow(UploadValidationError);
    });

    it("should reject files exceeding max size limit", () => {
      const largeBuf = new Uint8Array(200);
      expect(() =>
        validateUploadedFile(largeBuf, "large.pdf", "application/pdf", { maxSizeBytes: 100 })
      ).toThrow(UploadValidationError);
    });

    it("should reject disallowed MIME types", () => {
      expect(() =>
        validateUploadedFile(validPdfBuffer, "script.js", "text/javascript")
      ).toThrow(UploadValidationError);
    });

    it("should detect MIME spoofing (e.g. executable disguised as PDF)", () => {
      const spoofedBuffer = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      expect(() =>
        validateUploadedFile(spoofedBuffer, "fake.pdf", "application/pdf")
      ).toThrow("File magic bytes do not match any supported file type");
    });

    it("should detect MIME type mismatch (PNG bytes with PDF declared)", () => {
      expect(() =>
        validateUploadedFile(validPngBuffer, "fake.pdf", "application/pdf")
      ).toThrow("MIME type mismatch");
    });
  });
});
