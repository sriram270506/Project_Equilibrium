import { ReactNode } from "react";
import { cn } from "@/src/lib/utils";

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-body border-line-strong",
  ok: "bg-ok-wash text-ok border-ok/30",
  warn: "bg-warn-wash text-warn border-warn/30",
  danger: "bg-danger-wash text-danger border-danger/30",
  info: "bg-info-wash text-info border-info/30",
  brand: "bg-brand-wash text-brand-strong border-brand/30",
};

/**
 * Every domain status in one place, so a status string can never render as
 * undifferentiated grey text again. `label` is the human phrasing an operator
 * would actually say out loud; `meaning` explains the state in one sentence.
 */
const STATUS_MAP: Record<
  string,
  { tone: Tone; label: string; meaning: string }
> = {
  // Payment intent lifecycle
  INTENT_CREATED: {
    tone: "neutral",
    label: "Intent created",
    meaning: "Recorded internally with a balanced ledger entry, not yet sent to the provider.",
  },
  SUBMITTED: {
    tone: "info",
    label: "Submitted",
    meaning: "Sent to the payment provider, awaiting acknowledgement.",
  },
  ACKNOWLEDGED: {
    tone: "info",
    label: "Acknowledged",
    meaning: "The provider accepted the instruction and is processing it.",
  },
  CONFIRMED: {
    tone: "ok",
    label: "Confirmed",
    meaning: "The provider executed the payment. Money has moved.",
  },
  UNKNOWN: {
    tone: "warn",
    label: "Unknown",
    meaning:
      "We lost contact before learning the outcome. Money may or may not have moved - reconciliation will resolve it.",
  },
  FAILED: {
    tone: "danger",
    label: "Failed",
    meaning: "The provider declined. No money moved.",
  },
  REVERSED: {
    tone: "danger",
    label: "Reversed",
    meaning: "A confirmed payment was undone by a compensating entry.",
  },
  MANUAL_REVIEW: {
    tone: "warn",
    label: "Manual review",
    meaning: "Held for a human decision. Nothing moves until an operator acts.",
  },
  PENDING_APPROVAL: {
    tone: "warn",
    label: "Awaiting second approval",
    meaning: "Above the maker-checker threshold. A second operator must approve.",
  },

  // Opportunity lifecycle
  RECOMMENDED: {
    tone: "brand",
    label: "Recommended",
    meaning: "The model flagged a shortfall and policy cleared the offer.",
  },
  APPROVED: {
    tone: "ok",
    label: "Approved",
    meaning: "An operator approved the offer and a payment was created.",
  },
  REJECTED: {
    tone: "neutral",
    label: "Rejected",
    meaning: "Policy or an operator declined. No offer was made.",
  },
  EXECUTED: {
    tone: "ok",
    label: "Executed",
    meaning: "The supplier has been paid.",
  },

  // Reconciliation outcomes
  MATCHED: {
    tone: "ok",
    label: "Matched",
    meaning: "Our records and the provider agree exactly.",
  },
  AMOUNT_MISMATCH: {
    tone: "danger",
    label: "Amount mismatch",
    meaning: "We and the provider disagree on how much moved. Highest severity.",
  },
  STATUS_MISMATCH: {
    tone: "warn",
    label: "Status mismatch",
    meaning: "We and the provider disagree on the outcome.",
  },
  MISSING_EXTERNAL: {
    tone: "danger",
    label: "Missing at provider",
    meaning: "We have a payment the provider has never heard of.",
  },
  MISSING_INTERNAL: {
    tone: "danger",
    label: "Missing internally",
    meaning: "The provider has a payment we have no record of. An orphan.",
  },
  DUPLICATE: {
    tone: "warn",
    label: "Duplicate",
    meaning: "The same payment appears more than once.",
  },

  // Case / dispute statuses
  OPEN: { tone: "warn", label: "Open", meaning: "Needs an operator decision." },
  INVESTIGATING: {
    tone: "info",
    label: "Investigating",
    meaning: "An operator has picked this up.",
  },
  RESOLVED: { tone: "ok", label: "Resolved", meaning: "Closed, no action outstanding." },
  FROZEN: {
    tone: "danger",
    label: "Frozen",
    meaning: "Payments to this counterparty are blocked pending investigation.",
  },
  DRAFT_READY: {
    tone: "ok",
    label: "Draft ready",
    meaning: "Evidence is complete and internally consistent.",
  },
  NEEDS_REVIEW: {
    tone: "warn",
    label: "Needs review",
    meaning: "Evidence is incomplete or contradicts itself.",
  },
  CLOSED: { tone: "neutral", label: "Closed", meaning: "No longer active." },

  // Outbox
  PENDING: {
    tone: "warn",
    label: "Pending",
    meaning: "Written inside the transaction, not yet published.",
  },
  PUBLISHED: {
    tone: "ok",
    label: "Published",
    meaning: "Appended to the event log exactly once.",
  },
};

export function statusMeaning(status: string): string {
  return STATUS_MAP[status]?.meaning ?? "";
}

export function statusLabel(status: string): string {
  return STATUS_MAP[status]?.label ?? status;
}

export function StatusChip({
  status,
  size = "md",
  showDot = true,
  className,
}: {
  status: string;
  size?: "sm" | "md";
  showDot?: boolean;
  className?: string;
}) {
  const entry = STATUS_MAP[status];
  const tone = entry?.tone ?? "neutral";
  const label = entry?.label ?? status;

  return (
    <span
      title={entry?.meaning}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
        toneClasses[tone],
        className
      )}
    >
      {showDot ? (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "ok" && "bg-ok",
            tone === "warn" && "bg-warn",
            tone === "danger" && "bg-danger",
            tone === "info" && "bg-info",
            tone === "brand" && "bg-brand",
            tone === "neutral" && "bg-ink-muted"
          )}
        />
      ) : null}
      {label}
    </span>
  );
}

/** A severity badge for reconciliation and risk surfaces. */
export function SeverityBadge({ severity }: { severity: string }) {
  const tone: Tone =
    severity === "CRITICAL" ? "danger" : severity === "WARNING" ? "warn" : "ok";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide",
        toneClasses[tone]
      )}
    >
      {severity}
    </span>
  );
}

/**
 * Horizontal lifecycle rail. Shows where a payment is in its state machine and,
 * critically, which states are terminal - so a viewer can see that UNKNOWN is
 * a state the system is designed to exit, not a dead end.
 */
export function LifecycleRail({
  steps,
  current,
}: {
  steps: string[];
  current: string;
}) {
  const currentIndex = steps.indexOf(current);

  return (
    <ol className="flex flex-wrap items-center gap-1">
      {steps.map((step, i) => {
        const done = currentIndex >= 0 && i < currentIndex;
        const active = step === current;
        return (
          <li key={step} className="flex items-center gap-1">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                active && "border-brand bg-brand text-white",
                done && "border-ok/30 bg-ok-wash text-ok",
                !active && !done && "border-line-soft bg-surface-sunken text-ink-muted"
              )}
            >
              {statusLabel(step)}
            </span>
            {i < steps.length - 1 ? (
              <span
                className={cn(
                  "h-px w-4",
                  done ? "bg-ok/40" : "bg-line-strong"
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Vertical event timeline for payment / audit history. */
export function Timeline({
  items,
}: {
  items: Array<{
    title: string;
    timestamp?: string | Date | null;
    actor?: string;
    tone?: Tone;
    detail?: ReactNode;
  }>;
}) {
  if (items.length === 0) {
    return (
      <p className="py-4 text-sm text-ink-muted">No events recorded yet.</p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {items.map((item, i) => {
        const tone = item.tone ?? "neutral";
        const isLast = i === items.length - 1;
        return (
          <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-surface-card",
                  tone === "ok" && "bg-ok",
                  tone === "warn" && "bg-warn",
                  tone === "danger" && "bg-danger",
                  tone === "info" && "bg-info",
                  tone === "brand" && "bg-brand",
                  tone === "neutral" && "bg-ink-muted"
                )}
              />
              {!isLast ? <span className="w-px flex-1 bg-line-strong" /> : null}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ink-strong">
                  {item.title}
                </p>
                {item.timestamp ? (
                  <time className="tabular text-2xs text-ink-muted">
                    {new Date(item.timestamp).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "medium",
                    })}
                  </time>
                ) : null}
              </div>
              {item.actor ? (
                <p className="mt-0.5 text-2xs text-ink-muted">
                  by {item.actor}
                </p>
              ) : null}
              {item.detail ? (
                <div className="mt-1.5 text-[13px] leading-relaxed text-ink-body">
                  {item.detail}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
