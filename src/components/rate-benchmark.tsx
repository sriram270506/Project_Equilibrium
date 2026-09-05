"use client";

import { Card, CardHeader, CardBody, Callout } from "./ui/primitives";
import { cn } from "@/src/lib/utils";
import type { RateBenchmark } from "@/src/lib/benchmark/market-data";

/**
 * Where this offer's price sits against the regulated incumbent.
 *
 * TReDS is the RBI-licensed platform that already does receivables discounting
 * in India at scale — Rs 3.47 lakh crore in FY26. Any product in this space is
 * competing with it whether it admits so or not, and a pricing surface that
 * never shows an unfavourable comparison is one nobody checked.
 *
 * When our rate is worse, this says so and gives the only honest defence:
 * access and speed, not price.
 */
export function RateBenchmarkCard({ benchmark }: { benchmark: RateBenchmark }) {
  const { ourRateBps, tredsLowBps, tredsHighBps, alternativeCreditBps } =
    benchmark;

  // Scale the bar to the alternative-credit ceiling, the worst realistic option.
  const scaleMax = Math.max(alternativeCreditBps, ourRateBps) * 1.08;
  const pct = (bps: number) => `${(bps / scaleMax) * 100}%`;

  const verdictTone = {
    BELOW_TREDS: "ok",
    WITHIN_TREDS_BAND: "ok",
    ABOVE_TREDS: "warn",
    ABOVE_ALTERNATIVE_CREDIT: "danger",
  }[benchmark.verdict] as "ok" | "warn" | "danger";

  const markerColour = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
  }[verdictTone];

  return (
    <Card>
      <CardHeader
        eyebrow="Priced against the market"
        title="How this compares with TReDS"
        hint="TReDS is the RBI-licensed receivables platform that already discounts invoices in India. This is the incumbent, not a hypothetical."
        action={
          <div className="text-right">
            <p
              className={cn(
                "tabular text-2xl font-semibold leading-none",
                verdictTone === "ok" && "text-ok",
                verdictTone === "warn" && "text-warn",
                verdictTone === "danger" && "text-danger"
              )}
            >
              {(ourRateBps / 100).toFixed(1)}%
            </p>
            <p className="mt-1 text-2xs text-ink-muted">our annualised rate</p>
          </div>
        }
      />

      <CardBody className="space-y-4">
        {/* One axis, three reference points, our marker on top. */}
        <div>
          <div className="relative h-12">
            {/* Full range track */}
            <div className="absolute inset-x-0 top-5 h-2 rounded-full bg-paper-tint" />

            {/* The TReDS band */}
            <div
              className="absolute top-5 h-2 rounded-full bg-ok/40"
              style={{
                left: pct(tredsLowBps),
                width: pct(tredsHighBps - tredsLowBps),
              }}
            />

            {/* Our rate */}
            <div
              className="absolute top-2.5 flex flex-col items-center"
              style={{ left: pct(ourRateBps), transform: "translateX(-50%)" }}
            >
              <div
                className={cn(
                  "h-7 w-[3px] rounded-full",
                  markerColour
                )}
              />
            </div>

            {/* Alternative credit ceiling */}
            <div
              className="absolute top-3.5 h-5 w-[2px] rounded-full bg-danger/60"
              style={{ left: pct(alternativeCreditBps) }}
            />
          </div>

          <div className="flex justify-between text-2xs text-ink-faint">
            <span>0%</span>
            <span className="text-ok">
              TReDS {tredsLowBps / 100}–{tredsHighBps / 100}%
            </span>
            <span className="text-danger">
              Bank credit {alternativeCreditBps / 100}%
            </span>
          </div>
        </div>

        <Callout tone={verdictTone} title={benchmark.assessment}>
          {benchmark.justification}
        </Callout>

        <div className="grid gap-3 sm:grid-cols-3">
          <Cell
            label="Versus TReDS midpoint"
            value={`${benchmark.vsTredsMidpointBps > 0 ? "+" : ""}${(benchmark.vsTredsMidpointBps / 100).toFixed(1)}pp`}
            tone={benchmark.vsTredsMidpointBps > 0 ? "warn" : "ok"}
          />
          <Cell
            label="Versus bank credit"
            value={`${((ourRateBps - alternativeCreditBps) / 100).toFixed(1)}pp`}
            tone={ourRateBps < alternativeCreditBps ? "ok" : "danger"}
          />
          <Cell
            label="Settlement"
            value="Seconds"
            tone="ok"
            hint="TReDS auctions settle T+1 or later"
          />
        </div>
      </CardBody>
    </Card>
  );
}

function Cell({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "danger";
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-rule bg-paper-sunken px-4 py-3">
      <p className="text-2xs font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p
        className={cn(
          "tabular mt-1.5 text-lg font-semibold",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger"
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-2xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
