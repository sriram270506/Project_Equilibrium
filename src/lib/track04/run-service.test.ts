import { describe, it, expect } from "vitest";
import { REVIEW_ACTIONS, evidenceFor } from "./run-service";
import { buildDataset, DATASET_SEED } from "./dataset";

/**
 * The review rules, tested without a database.
 *
 * The database-touching paths (recordReview, runAndRecord) are exercised end
 * to end against the live API in the browser rather than mocked here — a mock
 * of Prisma would assert that my mock behaves as I wrote it, which is not the
 * property in question.
 */

describe("review actions", () => {
  it("requires a note for every action except plain acceptance", () => {
    /*
     * The one action that may close an exception silently is agreeing with the
     * controller. Everything else is a human overriding or redirecting the
     * system, and an override with no stated reason is indistinguishable from
     * nobody having looked.
     */
    expect(REVIEW_ACTIONS.ACCEPTED.requiresNote).toBe(false);

    for (const [key, spec] of Object.entries(REVIEW_ACTIONS)) {
      if (key === "ACCEPTED") continue;
      expect(spec.requiresNote).toBe(true);
    }
  });

  it("gives every action a description an operator can act on", () => {
    for (const spec of Object.values(REVIEW_ACTIONS)) {
      expect(spec.label.length).toBeGreaterThan(5);
      expect(spec.description.length).toBeGreaterThan(40);
    }
  });

  it("covers the outcomes an operator actually needs", () => {
    const keys = Object.keys(REVIEW_ACTIONS);
    expect(keys).toContain("ACCEPTED");
    expect(keys).toContain("REJECTED");
    expect(keys).toContain("RELINKED");
    expect(keys).toContain("MARKED_DUPLICATE");
    expect(keys).toContain("FROZEN");
  });
});

describe("evidenceFor", () => {
  const escalated = buildDataset(DATASET_SEED).find(
    (r) => r.groundTruth.expectedAction === "ESCALATE"
  )!;

  it("rebuilds the full trail for a record from the seed alone", () => {
    /*
     * Evidence is regenerated rather than stored. The dataset is deterministic
     * and versioned, so regenerating is exact - and duplicating every
     * candidate record into the database would create two sources of truth
     * that can disagree.
     */
    const found = evidenceFor(escalated.recordId);
    expect(found).not.toBeNull();
    expect(found!.record.recordId).toBe(escalated.recordId);
    expect(found!.decision.outcome).not.toBe("AUTO_RESOLVED");
    expect(found!.decision.comparisons.length + found!.decision.trace.length)
      .toBeGreaterThan(0);
  });

  it("is stable across calls", () => {
    const a = evidenceFor(escalated.recordId);
    const b = evidenceFor(escalated.recordId);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns null for a record that does not exist", () => {
    expect(evidenceFor("rec_does_not_exist")).toBeNull();
  });
});
