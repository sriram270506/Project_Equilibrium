/**
 * In-process metrics.
 *
 * Counters and timings for the things an operator needs during an incident:
 * payment outcomes, webhook results, provider latency, reconciliation
 * mismatches, approvals, and risk blocks.
 *
 * Deliberately in-memory and dependency-free. That is a real limitation — the
 * numbers reset on restart and are per-instance, so they are useful for a demo
 * and for a single-process deployment, not for a fleet. The point is that the
 * call sites exist and are named consistently; swapping the sink for Prometheus
 * or OpenTelemetry later is a change to this file alone.
 */

type Labels = Record<string, string | number | boolean | undefined>;

interface Timing {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  /** Sorted sample, capped, for percentiles. */
  samples: number[];
}

const MAX_SAMPLES = 500;

const counters = new Map<string, number>();
const timings = new Map<string, Timing>();
const startedAt = Date.now();

/** Stable key: name plus sorted labels, so the same event always aggregates. */
function key(name: string, labels?: Labels): string {
  if (!labels) return name;
  const parts = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? `${name}{${parts.join(",")}}` : name;
}

export const metrics = {
  increment(name: string, labels?: Labels, by = 1): void {
    const k = key(name, labels);
    counters.set(k, (counters.get(k) ?? 0) + by);
  },

  observe(name: string, valueMs: number, labels?: Labels): void {
    const k = key(name, labels);
    const existing = timings.get(k);

    if (!existing) {
      timings.set(k, {
        count: 1,
        totalMs: valueMs,
        minMs: valueMs,
        maxMs: valueMs,
        samples: [valueMs],
      });
      return;
    }

    existing.count += 1;
    existing.totalMs += valueMs;
    existing.minMs = Math.min(existing.minMs, valueMs);
    existing.maxMs = Math.max(existing.maxMs, valueMs);
    if (existing.samples.length < MAX_SAMPLES) existing.samples.push(valueMs);
  },

  /** Time an async operation, recording duration and outcome. */
  async time<T>(name: string, fn: () => Promise<T>, labels?: Labels): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      metrics.observe(name, Date.now() - started, { ...labels, outcome: "ok" });
      metrics.increment(`${name}.total`, { ...labels, outcome: "ok" });
      return result;
    } catch (error) {
      metrics.observe(name, Date.now() - started, {
        ...labels,
        outcome: "error",
      });
      metrics.increment(`${name}.total`, { ...labels, outcome: "error" });
      throw error;
    }
  },

  snapshot(): {
    uptimeSeconds: number;
    counters: Record<string, number>;
    timings: Record<
      string,
      { count: number; meanMs: number; minMs: number; maxMs: number; p95Ms: number }
    >;
  } {
    const timingOut: Record<
      string,
      { count: number; meanMs: number; minMs: number; maxMs: number; p95Ms: number }
    > = {};

    for (const [k, t] of timings) {
      const sorted = [...t.samples].sort((a, b) => a - b);
      const p95Index = Math.min(
        sorted.length - 1,
        Math.floor(sorted.length * 0.95)
      );
      timingOut[k] = {
        count: t.count,
        meanMs: Math.round((t.totalMs / t.count) * 100) / 100,
        minMs: t.minMs,
        maxMs: t.maxMs,
        p95Ms: sorted[p95Index] ?? t.maxMs,
      };
    }

    return {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      counters: Object.fromEntries(counters),
      timings: timingOut,
    };
  },

  reset(): void {
    counters.clear();
    timings.clear();
  },
};
