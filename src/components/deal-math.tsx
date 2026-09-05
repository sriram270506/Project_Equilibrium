"use client";

import { DealEconomics, isFairToSupplier } from "@/src/lib/deal-economics";
import { Card, CardHeader, CardBody, Money, Callout } from "./ui/primitives";
import { cn } from "@/src/lib/utils";

/**
 * The trade, shown as money rather than as basis points.
 *
 * A judge watching a five-minute video should be able to see, without pausing,
 * exactly who pays what and who earns what.
 */
export function DealMathCard({
  deal,
  supplierName,
}: {
  deal: DealEconomics;
  supplierName?: string;
}) {
  const fair = isFairToSupplier(deal);
  const supplierPct =
    deal.faceValuePaise > 0
      ? (deal.supplierReceivesPaise / deal.faceValuePaise) * 100
      : 0;

  return (
    <Card>
      <CardHeader
        eyebrow="The trade"
        title="What each side gets"
        hint={
          supplierName
            ? `${supplierName} is paid today instead of in ${deal.daysEarly} days.`
            : `Paid today instead of in ${deal.daysEarly} days.`
        }
      />

      <CardBody className="space-y-5">
        {/* The split, as one proportional bar. */}
        <div>
          <div className="flex h-11 w-full overflow-hidden rounded-md border border-line-strong">
            <div
              className="flex items-center justify-start bg-brand px-3 text-white"
              style={{ width: `${supplierPct}%` }}
            >
              <span className="text-xs font-semibold">Supplier receives</span>
            </div>
            <div className="flex flex-1 items-center justify-end bg-ok px-3 text-white">
              <span className="text-xs font-semibold">Platform</span>
            </div>
          </div>
          <div className="mt-2 flex justify-between">
            <div>
              <p className="text-2xs text-ink-muted">Paid today</p>
              <p className="tabular text-xl font-semibold text-brand">
                <Money paise={deal.supplierReceivesPaise} />
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xs text-ink-muted">Platform earns</p>
              <p className="tabular text-xl font-semibold text-ok">
                <Money paise={deal.platformEarnsPaise} />
              </p>
            </div>
          </div>
        </div>

        {/* Line-by-line arithmetic anyone can audit. */}
        <dl className="rounded-md border border-line-soft bg-surface-sunken px-4 py-3 text-sm">
          <Line label={`Invoice face value, due in ${deal.daysEarly} days`}>
            <Money paise={deal.faceValuePaise} />
          </Line>
          <Line
            label={`Early payment discount (${(deal.discountBps / 100).toFixed(2)}%)`}
            tone="muted"
          >
            −<Money paise={deal.discountPaise} />
          </Line>
          <Line label="Supplier receives today" emphasis>
            <Money paise={deal.supplierReceivesPaise} />
          </Line>
          <div className="my-2 border-t border-line-strong" />
          <Line label="Platform gross earning">
            <Money paise={deal.platformEarnsPaise} />
          </Line>
          <Line
            label={`Less platform cost of capital (${deal.daysEarly} days)`}
            tone="muted"
          >
            −<Money paise={deal.platformCostOfCapitalPaise} />
          </Line>
          <Line label="Net margin to platform" emphasis>
            <Money paise={deal.netPlatformMarginPaise} />
          </Line>
        </dl>

        {/* The number that stops a supplier being quietly overcharged. */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className={cn(
              "rounded-md border p-3",
              fair ? "border-ok/30 bg-ok/[0.12]" : "border-danger/30 bg-danger/[0.12]"
            )}
          >
            <p className="text-2xs font-medium text-ink-muted">
              Annualized rate
            </p>
            <p
              className={cn(
                "tabular mt-1 text-2xl font-semibold",
                fair ? "text-ok" : "text-danger"
              )}
            >
              {deal.annualizedRatePercent.toFixed(1)}%
            </p>
            <p className="mt-1 text-2xs leading-snug text-ink-muted">
              {(deal.discountBps / 100).toFixed(2)}% over {deal.daysEarly} days,
              annualized
            </p>
          </div>

          <div className="rounded-md border border-line-soft bg-surface-card p-3">
            <p className="text-2xs font-medium text-ink-muted">
              Supplier saves vs. borrowing
            </p>
            <p className="tabular mt-1 text-2xl font-semibold text-ink-strong">
              <Money paise={deal.supplierSavingsVsAlternativePaise} />
            </p>
            <p className="mt-1 text-2xs leading-snug text-ink-muted">
              against {(deal.alternativeFundingRateBps / 100).toFixed(0)}%
              working-capital credit
            </p>
          </div>
        </div>

        {!fair ? (
          <Callout tone="danger" title="Priced above the supplier's alternative">
            At {deal.annualizedRatePercent.toFixed(1)}% annualized this costs the
            supplier more than borrowing at{" "}
            {(deal.alternativeFundingRateBps / 100).toFixed(0)}%. Policy blocks
            offers like this.
          </Callout>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Line({
  label,
  children,
  emphasis = false,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
  tone?: "default" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt
        className={cn(
          "text-[13px]",
          emphasis ? "font-medium text-ink-strong" : "text-ink-muted"
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "tabular text-right text-sm",
          emphasis ? "font-semibold text-ink-strong" : "text-ink-body",
          tone === "muted" && !emphasis && "text-ink-muted"
        )}
      >
        {children}
      </dd>
    </div>
  );
}
