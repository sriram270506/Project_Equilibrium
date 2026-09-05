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
import { Card, CardHeader, CardBody } from "./ui/primitives";

interface Observation {
  date: string;
  balancePaise: number;
  inflowPaise: number;
  outflowPaise: number;
  daysRunway: number;
}

/**
 * Thirty days of cash runway.
 *
 * This is the chart that makes the problem visible: a line sliding toward zero
 * is a business about to miss payroll, and no probability score communicates
 * that as immediately. The shaded band under seven days is the zone where the
 * platform will consider stepping in.
 */
export function RunwayChart({
  observations,
  supplierName,
}: {
  observations: Observation[];
  supplierName: string;
}) {
  if (observations.length === 0) {
    return null;
  }

  const data = observations.map((o) => ({
    date: new Date(o.date).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    }),
    runway: Number(o.daysRunway.toFixed(1)),
    balance: o.balancePaise / 100,
  }));

  const latest = data[data.length - 1];
  const first = data[0];
  const trend = latest.runway - first.runway;

  return (
    <Card>
      <CardHeader
        eyebrow="Cash position"
        title="Days of runway, last 30 days"
        hint={
          trend < -1
            ? `${supplierName} has lost ${Math.abs(trend).toFixed(1)} days of cover over the month.`
            : `${supplierName} has held cover steady over the month.`
        }
        action={
          <div className="text-right">
            <p
              className={`tabular text-2xl font-semibold ${
                latest.runway < 3
                  ? "text-danger"
                  : latest.runway < 7
                    ? "text-warn"
                    : "text-ok"
              }`}
            >
              {latest.runway.toFixed(1)}
            </p>
            <p className="text-2xs text-ink-muted">days left today</p>
          </div>
        }
      />
      <CardBody>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            >
              <defs>
                <linearGradient id="runwayFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="rgb(37 99 235)"
                    stopOpacity={0.28}
                  />
                  <stop
                    offset="100%"
                    stopColor="rgb(37 99 235)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgb(226 232 240)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "rgb(92 106 133)" }}
                tickLine={false}
                axisLine={{ stroke: "rgb(203 213 225)" }}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "rgb(92 106 133)" }}
                tickLine={false}
                axisLine={false}
                width={44}
                label={{
                  value: "days",
                  angle: -90,
                  position: "insideLeft",
                  offset: 18,
                  style: { fontSize: 11, fill: "rgb(92 106 133)" },
                }}
              />

              {/* The line below which the platform will consider an offer. */}
              <ReferenceLine
                y={7}
                stroke="rgb(180 83 9)"
                strokeDasharray="4 4"
                label={{
                  value: "one week of cover",
                  position: "insideTopRight",
                  style: { fontSize: 10, fill: "rgb(180 83 9)" },
                }}
              />

              <Tooltip
                cursor={{ stroke: "rgb(197 187 170)" }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid rgb(226 232 240)",
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgb(12 18 38 / 0.08)",
                }}
                formatter={(value: number | string) => [
                  `${value} days`,
                  "Runway",
                ]}
              />

              <Area
                type="monotone"
                dataKey="runway"
                stroke="rgb(37 99 235)"
                strokeWidth={2}
                fill="url(#runwayFill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
