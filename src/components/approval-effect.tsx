"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardBody, Money, MonoId } from "./ui/primitives";
import { cn } from "@/src/lib/utils";

/**
 * What actually changed when you pressed approve.
 *
 * Before this, approving navigated straight to the payment page — the single
 * most consequential action in the product produced a page transition and
 * nothing else. You could not see that a journal had been posted, that the
 * portfolio commitment had moved, or that the supplier's forecast had lifted.
 *
 * Each effect reveals in sequence rather than all at once, because the ordering
 * is the point: the ledger commits inside the same transaction as the intent,
 * and only then does anything go to the provider.
 */

export interface EffectDelta {
  /** Ledger legs posted by this approval. */
  ledgerLegs: Array<{
    accountCode: string;
    debitPaise: number;
    creditPaise: number;
  }>;
  ledgerBalanced: boolean;
  /** Portfolio commitment before and after. */
  exposureBeforePaise: number;
  exposureAfterPaise: number;
  exposureLimitPaise: number;
  /** Supplier runway before and after, in days. Null when it never runs dry. */
  runwayBeforeDay: number | null;
  runwayAfterDay: number | null;
  /** Where the payment ended up. */
  paymentIntentId: string;
  paymentStatus: string;
  requiresDualApproval: boolean;
  amountPaise: number;
  supplierName: string;
}

interface Step {
  key: string;
  title: string;
  detail: React.ReactNode;
  tone: "ok" | "brand" | "warn";
}

export function ApprovalEffect({ delta }: { delta: EffectDelta }) {
  const [revealed, setRevealed] = useState(0);

  const steps: Step[] = [];

  /* 1. The journal, which commits with the intent. */
  const debits = delta.ledgerLegs.reduce((s, l) => s + l.debitPaise, 0);
  const credits = delta.ledgerLegs.reduce((s, l) => s + l.creditPaise, 0);

  steps.push({
    key: "ledger",
    title: `${delta.ledgerLegs.length} ledger entries posted`,
    tone: delta.ledgerBalanced ? "ok" : "warn",
    detail: (
      <div className="space-y-1">
        <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {delta.ledgerLegs.map((leg, i) => (
            <div
              key={`${leg.accountCode}-${i}`}
              className="flex items-baseline justify-between gap-3 text-2xs"
            >
              <span className="mono text-ink-muted">{leg.accountCode}</span>
              <span
                className={cn(
                  "tabular",
                  leg.debitPaise > 0 ? "text-brand-bright" : "text-ok"
                )}
              >
                {leg.debitPaise > 0 ? "Dr " : "Cr "}
                <Money
                  paise={leg.debitPaise > 0 ? leg.debitPaise : leg.creditPaise}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="pt-1 text-2xs text-ink-faint">
          <Money paise={debits} /> debits = <Money paise={credits} /> credits.
          Written in the same transaction as the payment intent, so there is no
          moment where one exists without the other.
        </p>
      </div>
    ),
  });

  /* 2. Portfolio commitment moved. */
  const exposureDelta = delta.exposureAfterPaise - delta.exposureBeforePaise;
  const pctBefore =
    delta.exposureLimitPaise > 0
      ? (delta.exposureBeforePaise / delta.exposureLimitPaise) * 100
      : 0;
  const pctAfter =
    delta.exposureLimitPaise > 0
      ? (delta.exposureAfterPaise / delta.exposureLimitPaise) * 100
      : 0;

  /*
   * This metric is commitment AWAITING APPROVAL, so approving an offer moves it
   * out of the queue and the number falls. Describing that as "headroom fell"
   * was simply wrong - the offer left the pending queue and became an actual
   * payment.
   */
  const movedOutOfQueue = exposureDelta < 0;

  steps.push({
    key: "exposure",
    title: movedOutOfQueue
      ? "Left the pending-approval queue"
      : "Pending commitment rose",
    tone: pctAfter > 85 ? "warn" : "brand",
    detail: (
      <div className="space-y-2">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
          {/* Where it was, held behind the new value. */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/[0.14]"
            style={{ width: `${Math.min(pctBefore, 100)}%` }}
          />
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-spring",
              pctAfter > 85 ? "bg-danger" : "bg-brand"
            )}
            style={{ width: `${Math.min(pctAfter, 100)}%` }}
          />
        </div>
        <p className="text-2xs leading-relaxed text-ink-faint">
          Offers awaiting approval:{" "}
          <Money paise={delta.exposureBeforePaise} /> →{" "}
          <span className="text-ink-body">
            <Money paise={delta.exposureAfterPaise} />
          </span>{" "}
          against a <Money paise={delta.exposureLimitPaise} /> daily limit.
          {exposureDelta !== 0 ? (
            <>
              {" "}
              {movedOutOfQueue ? (
                <>
                  This offer moved <Money paise={Math.abs(exposureDelta)} /> out
                  of the queue and into an actual payment, so the remaining
                  commitment is what still needs a decision.
                </>
              ) : (
                <>
                  Pending commitment rose by{" "}
                  <Money paise={Math.abs(exposureDelta)} />.
                </>
              )}
            </>
          ) : null}
        </p>
      </div>
    ),
  });

  /* 3. The supplier's forecast. */
  const runwayGained =
    delta.runwayBeforeDay !== null
      ? (delta.runwayAfterDay ?? 15) - delta.runwayBeforeDay
      : 0;

  steps.push({
    key: "forecast",
    title:
      delta.runwayAfterDay === null && delta.runwayBeforeDay !== null
        ? "The supplier no longer runs out of cash"
        : `Runway extended by ${runwayGained} day${runwayGained === 1 ? "" : "s"}`,
    tone: "ok",
    detail: (
      <p className="text-2xs leading-relaxed text-ink-faint">
        {delta.runwayBeforeDay !== null ? (
          <>
            The median path crossed zero on day {delta.runwayBeforeDay}.{" "}
            {delta.runwayAfterDay === null
              ? "With this advance it stays positive for the whole 14-day horizon."
              : `It now crosses on day ${delta.runwayAfterDay}.`}
          </>
        ) : (
          "This supplier was already projected to stay solvent; the advance widens the margin."
        )}
      </p>
    ),
  });

  /* 4. Where the money actually is. */
  steps.push({
    key: "payment",
    title: delta.requiresDualApproval
      ? "Held for a second approver"
      : `Payment ${delta.paymentStatus.toLowerCase()}`,
    tone: delta.requiresDualApproval ? "warn" : "ok",
    detail: (
      <p className="text-2xs leading-relaxed text-ink-faint">
        {delta.requiresDualApproval ? (
          <>
            <Money paise={delta.amountPaise} /> is above the dual-approval
            threshold, so nothing has been sent to the provider. A second
            operator must confirm, and it cannot be you.
          </>
        ) : (
          <>
            <Money paise={delta.amountPaise} /> instructed to the provider with
            an idempotency key. A retry after a crash returns the original
            payout rather than sending a second one.
          </>
        )}
      </p>
    ),
  });

  // Reveal one step at a time, so the ordering reads as a sequence.
  useEffect(() => {
    if (revealed >= steps.length) return;
    const timer = setTimeout(() => setRevealed((n) => n + 1), 420);
    return () => clearTimeout(timer);
  }, [revealed, steps.length]);

  return (
    <Card tone="accent">
      <CardHeader
        eyebrow="What just happened"
        title={`Approved — ${delta.supplierName}`}
        hint="Each effect below is a real state change, revealed in the order it occurred."
        action={
          <Link
            href={`/dashboard/payments/${delta.paymentIntentId}`}
            className="focusable btn-lift rounded-lg border border-white/20 bg-gradient-to-b from-brand-deep to-[rgb(29_78_216)] px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-glow-brand"
          >
            Trace the payment →
          </Link>
        }
      />

      <CardBody>
        <ol className="space-y-2.5">
          {steps.map((step, index) => {
            const shown = index < revealed;
            return (
              <li
                key={step.key}
                className={cn(
                  "rounded-lg border px-4 py-3 transition-all duration-500 ease-spring",
                  shown
                    ? "translate-y-0 opacity-100"
                    : "pointer-events-none translate-y-2 opacity-0",
                  step.tone === "ok" && "border-ok/25 bg-ok/[0.07]",
                  step.tone === "brand" && "border-brand/25 bg-brand/[0.07]",
                  step.tone === "warn" && "border-warn/25 bg-warn/[0.07]"
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                      step.tone === "ok" && "bg-ok",
                      step.tone === "brand" && "bg-brand",
                      step.tone === "warn" && "bg-warn"
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink-strong">
                      {step.title}
                    </p>
                    <div className="mt-1.5">{step.detail}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-3 flex items-center gap-2 text-2xs text-ink-faint">
          Correlation
          <MonoId value={delta.paymentIntentId} truncate={18} />
          threads this through the ledger, the event log, and reconciliation.
        </p>
      </CardBody>
    </Card>
  );
}
