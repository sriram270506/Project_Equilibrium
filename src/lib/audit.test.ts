import { describe, it, expect } from "vitest";
import { computeEntryHash, GENESIS_HASH } from "./audit";

/**
 * Pure tests for the hash chain. The database-backed verification is exercised
 * by the tamper endpoint and the demo:verify script; here we pin the properties
 * the whole scheme rests on.
 */

const base = {
  sequence: 1,
  eventType: "PAYMENT_CONFIRMED",
  actorType: "SYSTEM",
  actorId: "payment-service",
  aggregateType: "PAYMENT_INTENT",
  aggregateId: "pay_123",
  payloadJson: JSON.stringify({ amount_paise: 150000 }),
  correlationId: "corr_abc",
  createdAt: new Date("2026-09-02T10:00:00.000Z"),
  previousHash: GENESIS_HASH,
};

describe("Audit hash chain", () => {
  it("is deterministic for identical content", () => {
    expect(computeEntryHash(base)).toBe(computeEntryHash({ ...base }));
  });

  it("produces a 64-character SHA-256 hex digest", () => {
    expect(computeEntryHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the amount in the payload is altered", () => {
    const tampered = {
      ...base,
      payloadJson: JSON.stringify({ amount_paise: 15000000 }),
    };
    expect(computeEntryHash(tampered)).not.toBe(computeEntryHash(base));
  });

  it("changes when the actor is altered", () => {
    const tampered = { ...base, actorId: "someone-else" };
    expect(computeEntryHash(tampered)).not.toBe(computeEntryHash(base));
  });

  it("changes when the timestamp is backdated", () => {
    const tampered = { ...base, createdAt: new Date("2026-09-01T10:00:00.000Z") };
    expect(computeEntryHash(tampered)).not.toBe(computeEntryHash(base));
  });

  it("changes when the predecessor changes, which is what chains the log", () => {
    const tampered = { ...base, previousHash: "f".repeat(64) };
    expect(computeEntryHash(tampered)).not.toBe(computeEntryHash(base));
  });

  it("changes when an entry is resequenced", () => {
    const tampered = { ...base, sequence: 2 };
    expect(computeEntryHash(tampered)).not.toBe(computeEntryHash(base));
  });

  it("propagates a change forward: rewriting entry 1 invalidates entry 2", () => {
    const originalFirst = computeEntryHash(base);
    const second = { ...base, sequence: 2, previousHash: originalFirst };
    const originalSecond = computeEntryHash(second);

    // Someone edits entry 1 after the fact.
    const alteredFirst = computeEntryHash({
      ...base,
      payloadJson: JSON.stringify({ amount_paise: 1 }),
    });

    // Entry 2 still points at the OLD hash, so the chain no longer links up.
    expect(alteredFirst).not.toBe(originalFirst);
    expect(second.previousHash).not.toBe(alteredFirst);

    // And recomputing entry 2 against the altered predecessor gives a
    // different hash than the one stored with it.
    const recomputedSecond = computeEntryHash({
      ...second,
      previousHash: alteredFirst,
    });
    expect(recomputedSecond).not.toBe(originalSecond);
  });
});
