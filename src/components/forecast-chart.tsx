"use client";

import {
  Area,
  ComposedChart,
  Line,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardHeader, CardBody, Money, Callout } from "./ui/primitives";
import { cn } from "@/src/lib/utils";
import type {
  CashProjection,
  InterventionComparison,
} from "@/src/lib/forecast/cash-projection";

/**
 * The chart that replaces a probability with a decision.
 *
 * "64% risk" tells an operator to worry. A balance curve crossing zero on day
 * nine tells them when, by how much, and what an advance would change. The
 * shaded band is the p10-p90 spread, so the uncertainty is visible rather than
 * hidden behind a single confident line.
 */

interface ChartPoint {
  day: string;
  baseline: number;
  bandLow: number;
  bandSpan: number;
  withAdvance?: number;
}

function toRupees(paise: number): number {
  return Math.round(paise / 100);
}

function formatAxis(rupees: number): string {
  const abs = Math.abs(rupees);
  if (abs >= 1_00_000) return `${rupees < 0 ? "−" : ""}₹${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${rupees < 0 ? "−" : ""}₹${(abs / 1_000).toFixed(0)}k`;
  return `${rupees < 0 ? "−" : ""}₹${abs}`;
}

export function ForecastChart({
  projection,
  comparison,
  supplierName,
}: {
  projection: CashProjection;
  comparison?: InterventionComparison;
  supplierName: string;
}) {
  const data: ChartPoint[] = projection.days.map((d, i) => ({
    day: `D${d.day}`,
    baseline: toRupees(d.medianPaise),
    bandLow: toRupees(d.p10Paise),
    // Stacked areas need a span, not an upper bound.
    bandSpan: toRupees(d.p90Paise - d.p10Paise),
    withAdvance: comparison
      ? toRupees(comparison.withAdvance.days[i].medianPaise)
      : undefined,
  }));

  const crossing = projection.medianZeroCrossingDay;
  const crossingPoint =
    crossing !== null ? data[crossing - 1] : null;

  return (
    <Card>
      <CardHeader
        eyebrow="Cash-flow forecast"
        title={
          crossing !== null
            ? `${supplierName} runs out of cash on day ${crossing}`
            : `${supplierName} stays solvent across the horizon`
        }
        hint={`${projection.paths} simulated paths over ${projection.horizonDays} days. The shaded band is the 10th to 90th percentile — the spread is what tells you whether this is near-certain or merely possible.`}
        action={
          <div className="text-right">
            <p
              className={cn(
                "tabular text-2xl font-semibold leading-none",
                projection.shortfallProbability > 0.5
                  ? "text-danger"
                  : projection.shortfallProbability > 0.2
                    ? "text-warn"
                    : "text-ok"
              )}
            >
              {(projection.shortfallProbability * 100).toFixed(0)}%
            </p>
            <p className="mt-1 text-2xs text-ink-muted">
              of paths go negative
            </p>
          </div>
        }
      />

      <CardBody>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
            >
              <defs>
                <linearGradient id="advanceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgb(255 255 255 / 0.08)"
                vertical={false}
              />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "rgb(148 163 184)" }}
                tickLine={false}
                axisLine={{ stroke: "rgb(255 255 255 / 0.12)" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "rgb(148 163 184)" }}
                tickLine={false}
                axisLine={false}
                width={58}
                tickFormatter={formatAxis}
              />

              {/* Zero is the line that matters. Everything below it is insolvency. */}
              <ReferenceLine
                y={0}
                stroke="rgb(251 113 133)"
                strokeWidth={1.5}
                label={{
                  value: "out of cash",
                  position: "insideBottomRight",
                  style: { fontSize: 10, fill: "rgb(251 113 133)" },
                }}
              />

              {/* Uncertainty band, drawn as an invisible base plus a visible span. */}
              <Area
                dataKey="bandLow"
                stackId="band"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
                legendType="none"
                name="p10"
              />
              <Area
                dataKey="bandSpan"
                stackId="band"
                stroke="none"
                fill="rgb(96 165 250)"
                fillOpacity={0.14}
                isAnimationActive={false}
                name="10th–90th percentile"
              />

              <Line
                type="monotone"
                dataKey="baseline"
                stroke="rgb(96 165 250)"
                strokeWidth={2.5}
                dot={false}
                name="No intervention"
                animationDuration={900}
              />

              {comparison ? (
                <Line
                  type="monotone"
                  dataKey="withAdvance"
                  stroke="rgb(52 211 153)"
                  strokeWidth={2.5}
                  strokeDasharray="5 4"
                  dot={false}
                  name="With early payment"
                  animationDuration={1100}
                />
              ) : null}

              {/* Mark the exact day the median path fails. */}
              {crossingPoint ? (
                <ReferenceDot
                  x={crossingPoint.day}
                  y={crossingPoint.baseline}
                  r={5}
                  fill="rgb(251 113 133)"
                  stroke="rgb(7 11 24)"
                  strokeWidth={2}
                />
              ) : null}

              <Tooltip
                cursor={{ stroke: "rgb(255 255 255 / 0.2)" }}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid rgb(255 255 255 / 0.14)",
                  background: "rgb(13 19 38 / 0.96)",
                  fontSize: 12,
                  color: "rgb(226 232 240)",
                }}
                formatter={(value: number | string, name: string) => {
                  if (name === "p10") return [null, null];
                  const n = typeof value === "number" ? value : 0;
                  return [`₹${n.toLocaleString("en-IN")}`, name];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "rgb(148 163 184)" }}
                iconType="plainline"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* The numbers a decision actually needs. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Figure
            label="Median runs dry"
            value={crossing !== null ? `Day ${crossing}` : "Not within horizon"}
            tone={crossing !== null ? "danger" : "ok"}
          />
          <Figure
            label="First day at risk"
            value={
              projection.earliestRiskDay !== null
                ? `Day ${projection.earliestRiskDay}`
                : "None"
            }
            hint="10% of paths negative"
            tone={projection.earliestRiskDay !== null ? "warn" : "ok"}
          />
          <Figure
            label="Cash needed to bridge"
            value={<Money paise={projection.cashNeededPaise} />}
            hint="keeps the median above zero"
            tone="brand"
          />
        </div>

        {comparison ? (
          <div className="mt-4">
            <Callout
              tone={comparison.shortfallAverted ? "ok" : "warn"}
              title={
                comparison.shortfallAverted
                  ? "The advance averts the shortfall entirely"
                  : `The advance buys ${comparison.runwayDaysGained} more days`
              }
            >
              Paying <Money paise={comparison.advancePaise} /> today moves the
              green line above zero for the whole horizon and drops the
              probability of running short by{" "}
              <strong>{comparison.riskReductionPoints} percentage points</strong>
              {comparison.shortfallAverted
                ? "."
                : ", though it does not remove the risk completely."}{" "}
              Both curves use the same random seed, so the difference between
              them is the intervention and nothing else.
            </Callout>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone: "ok" | "warn" | "danger" | "brand";
}) {
  const toneClass = {
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    brand: "text-brand-bright",
  }[tone];

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3">
      <p className="text-2xs font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p className={cn("tabular mt-1.5 text-lg font-semibold", toneClass)}>
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-2xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}
