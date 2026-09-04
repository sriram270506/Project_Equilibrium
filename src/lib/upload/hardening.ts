/**
 * File upload hardening utilities for invoice pipeline.
 * Protects against bad files, spoofed MIME types, oversized payloads, and path traversal attacks.
 */

export const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface UploadValidationOptions {
  maxSizeBytes?: number;
  allowedMimeTypes?: readonly string[];
}

export function stripImageMetadata(buffer: Uint8Array, mimeType: AllowedMimeType): Uint8Array {
  if (mimeType === "application/pdf") {
    const text = new TextDecoder("latin1").decode(buffer);
    const scrubbed = text.replace(
      /\/(Title|Author|Subject|Creator|Producer|Keywords|CreationDate|ModDate)\s*\(([^)]*)\)/g,
      (_match, key: string, value: string) => `/${key} (${" ".repeat(value.length)})`
    );
    return Uint8Array.from([...scrubbed].map((character) => character.charCodeAt(0)));
  }

  if (mimeType === "image/png") {
    const output: number[] = [];
    let offset = 0;
    while (offset + 12 <= buffer.length) {
      const length = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0);
      const chunkEnd = offset + 12 + length;
      if (chunkEnd > buffer.length) return buffer;
      const type = String.fromCharCode(...buffer.slice(offset + 4, offset + 8));
      if (type === "IHDR" || type === "IDAT" || type === "IEND" || type === "PLTE") {
        output.push(...buffer.slice(offset, chunkEnd));
      }
      offset = chunkEnd;
      if (type === "IEND") break;
    }
    return output.length > 0 ? Uint8Array.from(output) : buffer;
  }

  if (mimeType !== "image/jpeg" || buffer.length < 4) return buffer;
  const output = [buffer[0], buffer[1]];
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return buffer;
    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      output.push(...buffer.slice(offset));
      break;
    }
    const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
    if (length < 2 || offset + 2 + length > buffer.length) return buffer;
    const isMetadata = marker === 0xe1 || marker === 0xfe || marker === 0xed;
    if (!isMetadata) output.push(...buffer.slice(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return Uint8Array.from(output);
}

export class UploadValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

/**
 * Sanitize a filename to prevent path traversal and shell injection issues.
 */
export function sanitizeFileName(rawFileName: string): string {
  if (!rawFileName || typeof rawFileName !== "string") {
    return "unnamed_file";
  }

  // Remove null bytes
  let clean = rawFileName.replace(/\0/g, "");

  // Extract basename to strip path components (Windows or Unix)
  clean = clean.split(/[/\\]/).pop() || "unnamed_file";

  // Strip path traversal sequences
  clean = clean.replace(/\.\.+/g, ".");

  // Remove dangerous characters (keep alphanumerics, dots, hyphens, underscores)
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Prevent hidden files / empty name before extension
  if (clean.startsWith(".")) {
    clean = "file" + clean;
  }

  return clean.slice(0, 255);
}

/**
 * Check if buffer magic bytes match the expected MIME type signature.
 */
export function detectMagicBytesMime(buffer: Uint8Array): AllowedMimeType | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // PDF check: %PDF (0x25, 0x50, 0x44, 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "application/pdf";
  }

  // PNG check: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG check: 0xFF, 0xD8, 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  return null;
}

/**
 * Validate an uploaded file against size, MIME allowlist, and magic byte header verification.
 */
export function validateUploadedFile(
  fileBuffer: Uint8Array | Buffer,
  fileName: string,
  declaredMimeType: string,
  options: UploadValidationOptions = {}
): { sanitizedFileName: string; mimeType: AllowedMimeType; sizeBytes: number } {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const allowedMimeTypes = options.allowedMimeTypes ?? ALLOWED_MIME_TYPES;

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new UploadValidationError("Uploaded file is empty", "EMPTY_FILE");
  }

  if (fileBuffer.length > maxSizeBytes) {
    throw new UploadValidationError(
      `File size (${fileBuffer.length} bytes) exceeds limit of ${maxSizeBytes} bytes`,
      "FILE_TOO_LARGE"
    );
  }

  const normalizedDeclaredMime = declaredMimeType.toLowerCase().trim();
  if (!allowedMimeTypes.includes(normalizedDeclaredMime)) {
    throw new UploadValidationError(
      `Invalid or unsupported MIME type: ${declaredMimeType}`,
      "INVALID_MIME_TYPE"
    );
  }

  const detectedMime = detectMagicBytesMime(fileBuffer);
  if (!detectedMime) {
    throw new UploadValidationError(
      "File magic bytes do not match any supported file type (PDF, PNG, JPEG)",
      "SPOOFED_FILE_HEADER"
    );
  }

  if (detectedMime !== normalizedDeclaredMime) {
    throw new UploadValidationError(
      `MIME type mismatch: declared '${declaredMimeType}' does not match detected header '${detectedMime}'`,
      "MIME_MISMATCH"
    );
  }

  const sanitizedFileName = sanitizeFileName(fileName);

  return {
    sanitizedFileName,
    mimeType: detectedMime,
    sizeBytes: fileBuffer.length,
  };
}
