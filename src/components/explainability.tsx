"use client";

import { PredictionExplanation } from "@/src/lib/ml/explain";
import { Card, CardHeader, CardBody, Callout, MonoId } from "./ui/primitives";
import { cn } from "@/src/lib/utils";

/**
 * Why the model said what it said.
 *
 * The bars are exact: a logistic regression is additive in log-odds, so each
 * feature's contribution is coefficient x value and they sum to the logit.
 * This is not an approximation of the model - it is the model.
 */
export function ExplanationPanel({
  explanation,
  threshold = 0.5,
}: {
  explanation: PredictionExplanation;
  threshold?: number;
}) {
  const { probability, contributions, summary, counterfactual, modelVersion } =
    explanation;

  const flagged = probability >= threshold;
  const maxWeight = Math.max(...contributions.map((c) => c.weight), 0.0001);

  return (
    <Card>
      <CardHeader
        eyebrow="Model explanation"
        title="Why this supplier was flagged"
        hint="Every bar below is an exact contribution to the prediction, not a post-hoc estimate."
        action={
          <div className="text-right">
            <p
              className={cn(
                "tabular text-3xl font-semibold leading-none",
                flagged ? "text-warn" : "text-ok"
              )}
            >
              {(probability * 100).toFixed(0)}%
            </p>
            <p className="mt-1 text-2xs text-ink-muted">
              shortfall risk, 7 days
            </p>
          </div>
        }
      />

      <CardBody className="space-y-5">
        <p className="text-[15px] leading-relaxed text-ink-body">{summary}</p>

        <div className="space-y-3">
          {contributions.map((c) => {
            const raises = c.direction === "increases";
            const barWidth = Math.max((c.weight / maxWeight) * 100, 3);

            return (
              <div key={c.feature}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-ink-strong">
                    {c.label}
                  </span>
                  <span className="tabular text-sm text-ink-body">
                    {c.displayValue}
                  </span>
                </div>

                {/* Diverging bar: risk-increasing right, risk-reducing left. */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex h-2 flex-1 items-center">
                    <div className="flex w-1/2 justify-end">
                      {!raises ? (
                        <div
                          className="h-2 rounded-l-sm bg-ok"
                          style={{ width: `${barWidth}%` }}
                        />
                      ) : null}
                    </div>
                    <div className="h-3 w-px bg-line-strong" />
                    <div className="flex w-1/2 justify-start">
                      {raises ? (
                        <div
                          className="h-2 rounded-r-sm bg-warn"
                          style={{ width: `${barWidth}%` }}
                        />
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "tabular w-14 shrink-0 text-right text-2xs font-medium",
                      raises ? "text-warn" : "text-ok"
                    )}
                  >
                    {c.contribution >= 0 ? "+" : ""}
                    {c.contribution.toFixed(2)}
                  </span>
                </div>

                <p className="mt-1 text-[13px] leading-snug text-ink-muted">
                  {c.narrative}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-line-soft pt-3 text-2xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-warn" /> increases risk
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-ok" /> reduces risk
          </span>
          <span className="ml-auto">
            model <MonoId value={modelVersion} />
          </span>
        </div>

        <Callout tone="info" title="What would change this decision">
          {counterfactual}
        </Callout>
      </CardBody>
    </Card>
  );
}

/**
 * Compact inline version for list rows - a single sentence and a risk bar.
 */
export function RiskBar({
  probability,
  threshold = 0.5,
  label,
}: {
  probability: number;
  threshold?: number;
  label?: string;
}) {
  const pct = Math.round(probability * 100);
  const tone =
    probability >= 0.75 ? "danger" : probability >= threshold ? "warn" : "ok";

  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular text-sm font-semibold text-ink-strong">
          {pct}%
        </span>
        {label ? (
          <span className="text-2xs text-ink-muted">{label}</span>
        ) : null}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "danger" && "bg-danger",
            tone === "warn" && "bg-warn",
            tone === "ok" && "bg-ok"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
