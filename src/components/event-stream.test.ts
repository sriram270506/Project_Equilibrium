import { describe, it, expect } from "vitest";
import { mergeEvents } from "./event-stream";

/**
 * The activity feed's merge.
 *
 * This exists because the live console reported duplicate React keys: two
 * polls in flight at once both read the same `since` cursor, both fetched the
 * same rows, and both prepended them. The component now guards against
 * overlapping polls, but the merge itself must be safe regardless — a function
 * whose correctness depends on the caller behaving is a function that will
 * break the next time somebody adds a refresh button.
 */

type Ev = Parameters<typeof mergeEvents>[0][number];

function ev(sequence: number): Ev {
  return {
    sequence,
    eventType: "PAYMENT_CONFIRMED",
    label: "Provider confirmed the payment",
    tone: "ok",
    actorType: "PROVIDER",
    actorId: "razorpay",
    supplierName: "Aarav Industrial Components",
    amountPaise: 100000,
    correlationId: `corr_${sequence}`,
    createdAt: "2026-09-05T10:00:00.000Z",
    entryHash: `hash${sequence}`,
  };
}

describe("mergeEvents", () => {
  it("prepends new events newest-first", () => {
    // The API returns oldest-first; the feed reads newest-first.
    const merged = mergeEvents([], [ev(1), ev(2), ev(3)], 25);
    expect(merged.map((e) => e.sequence)).toEqual([3, 2, 1]);
  });

  it("is idempotent — the same page twice yields no duplicates", () => {
    /*
     * The exact failure that was on screen. Two overlapping polls delivered
     * the same rows and both were appended, so React saw two children with
     * key "16-78de8c83".
     */
    const once = mergeEvents([], [ev(1), ev(2)], 25);
    const twice = mergeEvents(once, [ev(1), ev(2)], 25);
    expect(twice.map((e) => e.sequence)).toEqual([2, 1]);
  });

  it("keeps the identical array when nothing is new", () => {
    // Returning a fresh array would re-render the list on every idle poll.
    const existing = mergeEvents([], [ev(1), ev(2)], 25);
    expect(mergeEvents(existing, [ev(2)], 25)).toBe(existing);
    expect(mergeEvents(existing, [], 25)).toBe(existing);
  });

  it("adds only the genuinely new events from an overlapping page", () => {
    const existing = mergeEvents([], [ev(1), ev(2), ev(3)], 25);
    const merged = mergeEvents(existing, [ev(2), ev(3), ev(4)], 25);
    expect(merged.map((e) => e.sequence)).toEqual([4, 3, 2, 1]);
  });

  it("never mutates the incoming array", () => {
    /*
     * The old code called `incoming.reverse()` in place, inside a state
     * updater React may invoke more than once - which reversed it twice and
     * put the feed back in the wrong order.
     */
    const incoming = [ev(1), ev(2), ev(3)];
    const snapshot = incoming.map((e) => e.sequence);
    mergeEvents([], incoming, 25);
    mergeEvents([], incoming, 25);
    expect(incoming.map((e) => e.sequence)).toEqual(snapshot);
  });

  it("caps the list so it cannot grow unbounded", () => {
    const many = Array.from({ length: 40 }, (_, i) => ev(i + 1));
    const merged = mergeEvents([], many, 25);
    expect(merged).toHaveLength(25);
    // The cap drops the OLDEST, so the newest event must survive.
    expect(merged[0].sequence).toBe(40);
  });

  it("holds every sequence unique across a long run of overlapping polls", () => {
    let feed: Ev[] = [];
    for (let tick = 1; tick <= 12; tick++) {
      // Each poll re-sends the last two events plus one new one, which is what
      // an overlapping cursor read produces.
      const page = [ev(tick), ev(tick + 1), ev(tick + 2)];
      feed = mergeEvents(feed, page, 25);
      feed = mergeEvents(feed, page, 25); // the duplicate poll
    }
    const seqs = feed.map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
