"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader, CardBody, Money, Callout } from "./ui/primitives";
import { cn } from "@/src/lib/utils";

/**
 * Portfolio-level commitment over the next fortnight.
 *
 * A per-supplier forecast answers "should I approve this one?". A treasury
 * operator also has to answer "how much am I committing across the whole book,
 * and can we fund it?" — a different question, and the one that decides whether
 * the platform can say yes at all.
 */

export interface PortfolioForecast {
  horizonDays: number;
  curve: Array<{
    day: number;
    newCommitmentPaise: number;
    cumulativePaise: number;
  }>;
  peakExposurePaise: number;
  dailyLimitPaise: number;
  headroomPaise: number;
  utilisation: number;
  withinLimit: boolean;
}

export function PortfolioExposure({
  forecast,
}: {
  forecast: PortfolioForecast;
}) {
  const data = forecast.curve.map((point) => ({
    day: `D${point.day}`,
    committed: Math.round(point.cumulativePaise / 100),
    limit: Math.round(forecast.dailyLimitPaise / 100),
  }));

  const pct = Math.round(forecast.utilisation * 100);

  return (
    <Card>
      <CardHeader
        eyebrow="Portfolio commitment"
        title={
          forecast.withinLimit
            ? `Peak commitment stays within the daily limit`
            : `Peak commitment would breach the daily limit`
        }
        hint={`If every outstanding offer is approved, this is what the platform commits over ${forecast.horizonDays} days. Offers are placed by urgency — the most distressed suppliers draw soonest.`}
        action={
          <div className="text-right">
            <p
              className={cn(
                "tabular text-2xl font-semibold leading-none",
                forecast.withinLimit ? "text-ok" : "text-danger"
              )}
            >
              {pct}%
            </p>
            <p className="mt-1 text-2xs text-ink-muted">of the daily limit</p>
          </div>
        }
      />

      <CardBody className="space-y-4">
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
            >
              <defs>
                <linearGradient id="exposureFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="rgb(139 92 246)"
                    stopOpacity={0.35}
                  />
                  <stop
                    offset="100%"
                    stopColor="rgb(139 92 246)"
                    stopOpacity={0.02}
                  />
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
                tickFormatter={(v: number) =>
                  v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}k`
                }
              />

              {/* The limit is the line that decides whether we can say yes. */}
              <ReferenceLine
                y={Math.round(forecast.dailyLimitPaise / 100)}
                stroke="rgb(251 113 133)"
                strokeDasharray="5 4"
                label={{
                  value: "daily exposure limit",
                  position: "insideTopRight",
                  style: { fontSize: 10, fill: "rgb(251 113 133)" },
                }}
              />

              <Area
                type="stepAfter"
                dataKey="committed"
                stroke="rgb(167 139 250)"
                strokeWidth={2.5}
                fill="url(#exposureFill)"
                name="Cumulative commitment"
                animationDuration={900}
              />

              <Tooltip
                cursor={{ stroke: "rgb(255 255 255 / 0.2)" }}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid rgb(255 255 255 / 0.14)",
                  background: "rgb(13 19 38 / 0.96)",
                  fontSize: 12,
                  color: "rgb(226 232 240)",
                }}
                formatter={(value: number | string) => [
                  `₹${Number(value).toLocaleString("en-IN")}`,
                  "Committed",
                ]}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Utilisation as a bar, since that is the number treasury watches. */}
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn(
                "bar-grow h-full rounded-full",
                pct > 85 ? "bg-danger" : pct > 60 ? "bg-warn" : "bg-ok"
              )}
              style={{ width: `${Math.max(pct, 1)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[13px]">
            <span className="text-ink-muted">
              Peak <Money paise={forecast.peakExposurePaise} />
            </span>
            <span className="text-ink-muted">
              Headroom <Money paise={forecast.headroomPaise} />
            </span>
          </div>
        </div>

        {!forecast.withinLimit ? (
          <Callout tone="danger" title="Not all of these can be approved today">
            Approving every outstanding offer would exceed the daily exposure
            limit. Risk controls will refuse the ones that cross it, so they
            need prioritising by urgency rather than processing in order.
          </Callout>
        ) : null}
      </CardBody>
    </Card>
  );
}
