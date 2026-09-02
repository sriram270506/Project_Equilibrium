import crypto from "crypto";
import { ConflictError } from "./errors";
import { generateIdempotencyKey as generateIdempotencyKeyFromIds } from "./ids";

/**
 * Generate a deterministic fingerprint of a request
 */
export function generateRequestFingerprint(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Generate an idempotency key with idem_ prefix
 */
export function generateIdempotencyKey(): string {
  return generateIdempotencyKeyFromIds();
}

/**
 * Validate that an idempotency key hasn't been used with different payload
 */
export async function validateIdempotencyKey(
  idempotencyKey: string,
  currentFingerprint: string,
  getStoredFingerprint: () => Promise<string | null>
): Promise<void> {
  const storedFingerprint = await getStoredFingerprint();

  if (storedFingerprint === null) {
    // New idempotency key, proceed
    return;
  }

  if (storedFingerprint !== currentFingerprint) {
    throw new ConflictError(
      "Idempotency key reused with different request payload",
      {
        idempotencyKey,
        storedFingerprint,
        currentFingerprint,
      }
    );
  }
}

/**
 * Store idempotency key with fingerprint
 */
export async function storeIdempotencyKey(
  idempotencyKey: string,
  fingerprint: string,
  store: (key: string, fp: string) => Promise<void>
): Promise<void> {
  await store(idempotencyKey, fingerprint);
}
