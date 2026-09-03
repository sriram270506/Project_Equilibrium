import { NextRequest } from "next/server";
import { prisma } from "../prisma";
import { IdempotencyError } from "../errors";
import { generateId } from "../ids";

/**
 * Idempotency key middleware for financial operations
 * Prevents duplicate execution of retried requests
 */

export interface IdempotencyRecord {
  id: string;
  idempotencyKey: string;
  operationId: string; // Financial operation ID (payment, approval, etc.)
  requestHash: string; // Hash of request body for validation
  responseHash: string; // Hash of response for replay
  status: "PENDING" | "SUCCESS" | "FAILED";
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Extract and validate idempotency key from request
 * Throws if missing or invalid format
 */
export function extractIdempotencyKey(request: NextRequest): string {
  const key = request.headers.get("Idempotency-Key");

  if (!key) {
    throw new Error("Idempotency-Key header is required");
  }

  if (key.length < 10 || key.length > 256) {
    throw new Error("Idempotency-Key must be 10-256 characters");
  }

  if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
    throw new Error("Idempotency-Key must contain only alphanumeric, dash, underscore");
  }

  return key;
}

/**
 * Check if this idempotency key was already processed
 * Returns existing result if so, null if new request
 */
export async function checkIdempotency(
  idempotencyKey: string,
  operationType: string,
  requestHash: string
) {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key: idempotencyKey },
  });

  if (!existing) {
    return null;
  }

  // Same request being retried — return cached result
  if (existing.requestHash === requestHash) {
    if (existing.status === "PENDING") {
      throw new Error("Request is still processing, please retry later");
    }
    return {
      operationId: existing.operationId,
      status: existing.status,
      responseHash: existing.responseHash,
    };
  }

  // Different request with same key — conflict
  throw new IdempotencyError(
    "Idempotency key already used with different request",
    { idempotencyKey, previousRequest: existing.requestHash }
  );
}

/**
 * Mark idempotency key as processing
 */
export async function markIdempotencyPending(
  idempotencyKey: string,
  operationType: string,
  requestHash: string,
  operationId: string
) {
  return prisma.idempotencyKey.create({
    data: {
      key: idempotencyKey,
      operationType,
      requestHash,
      operationId,
      status: "PENDING",
    },
  });
}

/**
 * Mark idempotency key as completed
 */
export async function markIdempotencySuccess(
  idempotencyKey: string,
  responseHash: string
) {
  return prisma.idempotencyKey.update({
    where: { key: idempotencyKey },
    data: {
      status: "SUCCESS",
      responseHash,
      completedAt: new Date(),
    },
  });
}

/**
 * Mark idempotency key as failed
 */
export async function markIdempotencyFailed(
  idempotencyKey: string,
  error: string
) {
  return prisma.idempotencyKey.update({
    where: { key: idempotencyKey },
    data: {
      status: "FAILED",
      error,
      completedAt: new Date(),
    },
  });
}

/**
 * Retry-safe hash of request body
 */
export function hashRequestBody(body: unknown): string {
  const crypto = require("crypto");
  const json = JSON.stringify(body);
  return crypto.createHash("sha256").update(json).digest("hex");
}
