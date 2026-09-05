"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardBody, Money, MonoId } from "./ui/primitives";
import { cn } from "@/src/lib/utils";

/**
 * Live activity feed.
 *
 * Backend work is invisible by default. A payment submits, a webhook lands, a
 * reconciliation case opens — and none of it surfaces until someone navigates
 * to exactly the right page. This makes the system's own audit chain watchable,
 * so an action taken in one part of the console visibly registers here.
 *
 * New rows animate in. That is not decoration: motion is what tells a viewer
 * something just happened rather than having always been there.
 */

interface StreamEvent {
  sequence: number;
  eventType: string;
  label: string;
  tone: "ok" | "warn" | "danger" | "info" | "brand";
  actorType: string;
  actorId: string;
  supplierName: string | null;
  amountPaise: number | null;
  correlationId: string;
  createdAt: string;
  entryHash: string;
}

const TONE_DOT: Record<StreamEvent["tone"], string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  brand: "bg-brand",
};

const ACTOR_LABEL: Record<string, string> = {
  OPERATOR: "operator",
  SYSTEM: "system",
  PROVIDER: "provider",
  MODEL: "model",
};

/**
 * Merge a page of polled events into the feed.
 *
 * Extracted as a pure function so the part that actually broke can be tested
 * without a DOM. Two overlapping polls used to append the same rows twice,
 * which React reported as duplicate keys; the fix has to hold no matter how
 * many times it is called with the same input, and that is a property worth
 * asserting rather than eyeballing.
 *
 * `incoming` arrives oldest-first from the API and is never mutated.
 */
export function mergeEvents(
  previous: StreamEvent[],
  incoming: StreamEvent[],
  limit: number
): StreamEvent[] {
  if (incoming.length === 0) return previous;

  const seen = new Set(previous.map((e) => e.sequence));
  // Sequence is unique in the audit chain, so it is the identity here.
  const fresh = [...incoming].reverse().filter((e) => !seen.has(e.sequence));
  if (fresh.length === 0) return previous;

  return [...fresh, ...previous].slice(0, limit);
}

export function EventStream({
  pollMs = 4000,
  limit = 25,
}: {
  pollMs?: number;
  limit?: number;
}) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracked in a ref so the poll closure always reads the current value
  // without re-creating the interval on every tick.
  const highestSeen = useRef(0);

  /*
   * Guards against two polls being in flight at once.
   *
   * Without it, both read `highestSeen.current` before either writes it, both
   * ask the API for everything since the same sequence, and both prepend the
   * same rows - which React reports as duplicate keys. StrictMode's double
   * effect invocation makes this fire on every mount in development, but it is
   * a real race in production too: any response slower than the poll interval
   * overlaps the next tick.
   */
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(
        `/api/events/stream?since=${highestSeen.current}&limit=${limit}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "Could not read the event stream");
        return;
      }
      setError(null);

      const incoming: StreamEvent[] = json.data.events;
      if (incoming.length === 0) return;

      highestSeen.current = Math.max(
        highestSeen.current,
        ...incoming.map((e) => e.sequence)
      );

      /*
       * The merge is pure and never mutates `incoming`.
       *
       * The previous version called `incoming.reverse()` INSIDE the state
       * updater - mutating the response array from a function React treats as
       * pure and may invoke more than once. A second invocation reversed it
       * again and silently put the feed back in the wrong order, a bug that
       * would only ever surface as "the activity list is sometimes upside
       * down".
       */
      setEvents((previous) => mergeEvents(previous, incoming, limit));
    } catch {
      setError("Could not reach the API.");
    } finally {
      inFlight.current = false;
    }
  }, [limit]);

  useEffect(() => {
    poll();
    if (!live) return;
    const id = setInterval(poll, pollMs);
    return () => clearInterval(id);
  }, [poll, live, pollMs]);

  return (
    <Card>
      <CardHeader
        eyebrow="Activity"
        title="What the system is doing"
        hint="Every row is an entry in the hash-chained audit log — the same records the tamper check verifies, not a separate display log."
        action={
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={cn(
              "focusable inline-flex items-center gap-2 rounded-full border px-3 py-1 text-2xs font-medium transition-colors",
              live
                ? "border-ok/35 bg-ok/[0.12] text-ok"
                : "border-rule-strong bg-paper-sunken text-ink-muted"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                live ? "status-breathe bg-ok" : "bg-ink-faint"
              )}
            />
            {live ? "live" : "paused"}
          </button>
        }
      />

      <CardBody>
        {error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-muted">
            Nothing yet. Approve an offer or run the guided walkthrough and
            events will appear here as they happen.
          </p>
        ) : (
          <ol className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
            {events.map((event) => (
              <li
                key={`${event.sequence}-${event.entryHash.slice(0, 8)}`}
                className="fade-up flex items-start gap-3 rounded-lg border border-rule bg-paper-sunken px-3 py-2.5 transition-colors hover:border-rule-strong"
              >
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    TONE_DOT[event.tone]
                  )}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-medium text-ink-strong">
                      {event.label}
                    </p>
                    <time className="tabular shrink-0 text-2xs text-ink-faint">
                      {new Date(event.createdAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </div>

                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-faint">
                    <span className="tabular">#{event.sequence}</span>
                    <span>·</span>
                    <span>
                      {ACTOR_LABEL[event.actorType] ??
                        event.actorType.toLowerCase()}{" "}
                      {event.actorId}
                    </span>
                    {event.supplierName ? (
                      <>
                        <span>·</span>
                        <span className="text-ink-muted">
                          {event.supplierName}
                        </span>
                      </>
                    ) : null}
                    {event.amountPaise !== null ? (
                      <>
                        <span>·</span>
                        <span className="tabular text-ink-body">
                          <Money paise={event.amountPaise} />
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>

                <MonoId
                  value={event.correlationId}
                  truncate={10}
                  className="mt-0.5 shrink-0"
                />
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
