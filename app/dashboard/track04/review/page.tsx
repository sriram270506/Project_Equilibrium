"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Money,
  Button,
  LoadingState,
  ErrorState,
  EmptyState,
  Table,
  Th,
  Td,
  MonoId,
  Callout,
} from "@/src/components/ui/primitives";
import { cn } from "@/src/lib/utils";

/**
 * The human review queue.
 *
 * This is where the controller's abstentions get resolved. The controller
 * cannot close these itself — an exception it could close would not have been
 * an exception — so every action here is attributed to a person, timestamped,
 * and, for anything other than a plain acceptance, requires a stated reason.
 *
 * That last constraint is the point. An exception closed with no reason is
 * indistinguishable from an exception nobody looked at.
 */

interface Comparison {
  field: string;
  internalValue: string;
  externalValue: string;
  agreed: boolean;
  weight: number;
  note?: string;
}

interface Review {
  id: string;
  recordId: string;
  exceptionType: string;
  amountPaise: number;
  supplierName: string;
  confidence: number;
  reason: string;
  recommendedAction: string;
  whyNotAutoResolved: string;
  difficulty: string;
  status: string;
  reviewerId: string | null;
  reviewNote: string | null;
  linkedExternalId: string | null;
  reviewedAt: string | null;
  evidence: {
    scenario: string;
    groundTruthLabel: string;
    groundTruthNote: string;
    materialityPaise: number;
    internal: Record<string, unknown> | null;
    externals: Array<Record<string, unknown>>;
    comparisons: Comparison[];
    trace: Array<{ stage: string; kind: string; detail: string }>;
    outcome: string;
  } | null;
}

interface ActionSpec {
  label: string;
  requiresNote: boolean;
  description: string;
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: "border-warn/30 bg-warn/[0.12] text-warn",
  ACCEPTED: "border-ok/30 bg-ok/[0.12] text-ok",
  REJECTED: "border-danger/30 bg-danger/[0.12] text-danger",
  RELINKED: "border-info/30 bg-info/[0.12] text-info",
  MARKED_DUPLICATE: "border-danger/30 bg-danger/[0.12] text-danger",
  FROZEN: "border-brand/30 bg-brand/[0.12] text-brand",
};

const KIND_STYLE: Record<string, string> = {
  DETERMINISTIC: "border-info/30 bg-info/[0.10] text-info",
  STATISTICAL: "border-brand/30 bg-brand/[0.10] text-brand",
  POLICY: "border-warn/30 bg-warn/[0.10] text-warn",
};

export default function Track04ReviewPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [actions, setActions] = useState<Record<string, ActionSpec>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [linkedId, setLinkedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/track04/reviews?status=${filter}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) {
        setReviews(json.data.reviews);
        setActions(json.data.actions ?? {});
        setRunId(json.data.runId);
      } else {
        setError(json.error?.message ?? "Failed to load the review queue");
      }
    } catch {
      setError("Could not reach the API. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(reviewId: string, action: string) {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/track04/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId,
          action,
          note: note.trim() || undefined,
          linkedExternalId: linkedId.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setActionError(json.error?.message ?? "The action was refused");
        return;
      }
      setNote("");
      setLinkedId("");
      setOpenId(null);
      await load();
    } catch {
      setActionError("Could not reach the API.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading the review queue" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!reviews) return null;

  const open = reviews.filter((r) => r.status === "OPEN");
  const openRow = reviews.find((r) => r.id === openId);

  return (
    <div className="fade-up max-w-6xl">
      <PageHeader
        title="Exception review queue"
        lede="Records the controller refused to clear. It cannot close these itself — an exception it could close would not have been one — so every decision here is attributed to a person and, except for a plain acceptance, requires a stated reason."
        action={
          <div className="flex gap-2">
            <Link
              href="/dashboard/track04"
              className="focusable rounded-md border border-line-strong bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
            >
              Back to benchmark
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFilter(filter === "OPEN" ? "ALL" : "OPEN")}
            >
              {filter === "OPEN" ? "Show all" : "Show open only"}
            </Button>
          </div>
        }
      />

      {reviews.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing in the queue">
            {runId
              ? "Every exception from the latest run has been resolved."
              : "No evaluation has been recorded yet."}{" "}
            Run one from the{" "}
            <Link
              href="/dashboard/track04"
              className="font-medium text-brand hover:underline"
            >
              benchmark page
            </Link>
            .
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <Callout tone={open.length > 0 ? "warn" : "ok"} title={
              open.length > 0
                ? `${open.length} exceptions awaiting a decision`
                : "Every exception has been decided"
            }>
              <p>
                Holding{" "}
                <strong>
                  <Money
                    paise={open.reduce((s, r) => s + r.amountPaise, 0)}
                  />
                </strong>{" "}
                across {open.length} records from run{" "}
                <span className="mono">{runId}</span>. Nothing here moves until
                a person decides it.
              </p>
            </Callout>
          </div>

          <div className="mt-6">
            <Card>
              <CardHeader
                title={`${reviews.length} ${filter === "OPEN" ? "open" : "total"} exceptions`}
                hint="Click a row to open the full evidence trail and record a decision."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Record</Th>
                    <Th>Exception</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">Confidence</Th>
                    <Th>Supplier</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => {
                        setOpenId(openId === r.id ? null : r.id);
                        setNote("");
                        setLinkedId("");
                        setActionError(null);
                      }}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-surface-sunken",
                        openId === r.id && "bg-brand/[0.08]"
                      )}
                    >
                      <Td>
                        <MonoId value={r.recordId} truncate={12} />
                      </Td>
                      <Td>
                        <span className="mono text-2xs text-warn">
                          {r.exceptionType}
                        </span>
                      </Td>
                      <Td align="right" className="font-medium text-ink-strong">
                        <Money paise={r.amountPaise} />
                      </Td>
                      <Td align="right" className="tabular text-ink-muted">
                        {(r.confidence * 100).toFixed(0)}%
                      </Td>
                      <Td className="text-2xs text-ink-muted">
                        {r.supplierName}
                      </Td>
                      <Td>
                        <span
                          className={cn(
                            "rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            STATUS_STYLE[r.status] ??
                              "border-white/15 bg-paper-sunken text-ink-muted"
                          )}
                        >
                          {r.status.replace(/_/g, " ")}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          {openRow ? (
            <div className="mt-4">
              <Card tone="accent">
                <CardHeader
                  eyebrow={`${openRow.evidence?.scenario ?? "record"} · ${openRow.difficulty}`}
                  title={`${openRow.recordId} — ${openRow.exceptionType.replace(/_/g, " ").toLowerCase()}`}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setOpenId(null)}
                    >
                      Close
                    </Button>
                  }
                />
                <CardBody className="space-y-4">
                  <div className="rounded-lg border border-warn/25 bg-warn/[0.07] px-4 py-3">
                    <p className="text-[13px] font-medium text-ink-strong">
                      {openRow.reason}
                    </p>
                    <p className="mt-2 text-2xs uppercase tracking-wide text-warn">
                      Why not resolved automatically
                    </p>
                    <p className="mt-1 text-2xs leading-relaxed text-ink-body">
                      {openRow.whyNotAutoResolved}
                    </p>
                  </div>

                  {openRow.evidence ? (
                    <>
                      <div>
                        <p className="text-2xs uppercase tracking-wide text-ink-muted">
                          Candidate records considered
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {openRow.evidence.internal ? (
                            <div className="rounded-md border border-rule bg-paper-sunken px-3 py-2 text-2xs">
                              <span className="mono text-info">INTERNAL</span>{" "}
                              <span className="text-ink-body">
                                {String(openRow.evidence.internal.reference)} ·{" "}
                                {String(openRow.evidence.internal.supplierName)}{" "}
                                ·{" "}
                                <Money
                                  paise={
                                    openRow.evidence.internal
                                      .amountPaise as number
                                  }
                                />
                              </span>
                            </div>
                          ) : (
                            <div className="rounded-md border border-danger/25 bg-danger/[0.07] px-3 py-2 text-2xs text-danger">
                              No internal record exists for this settlement.
                            </div>
                          )}
                          {openRow.evidence.externals.length === 0 ? (
                            <div className="rounded-md border border-danger/25 bg-danger/[0.07] px-3 py-2 text-2xs text-danger">
                              The provider has no record of this payment.
                            </div>
                          ) : (
                            openRow.evidence.externals.map((e, i) => (
                              <div
                                key={i}
                                className="rounded-md border border-rule bg-paper-sunken px-3 py-2 text-2xs"
                              >
                                <span className="mono text-brand">
                                  {String(e.id)}
                                </span>{" "}
                                <span className="text-ink-body">
                                  {String(e.reference) || "(no reference)"} ·{" "}
                                  {String(e.beneficiaryName)} ·{" "}
                                  <Money paise={e.amountPaise as number} /> ·{" "}
                                  {String(e.status)} ·{" "}
                                  {String(e.utr ?? "no UTR")}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-2xs uppercase tracking-wide text-ink-muted">
                          Fields that matched and differed
                        </p>
                        <div className="mt-2 overflow-x-auto">
                          <Table>
                            <thead>
                              <tr>
                                <Th>Field</Th>
                                <Th>Ours</Th>
                                <Th>Provider</Th>
                                <Th align="right">Weight</Th>
                                <Th align="right">Agrees</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {openRow.evidence.comparisons.map((c) => (
                                <tr key={c.field}>
                                  <Td className="mono text-2xs">{c.field}</Td>
                                  <Td className="text-2xs">
                                    {c.internalValue}
                                  </Td>
                                  <Td className="text-2xs">
                                    {c.externalValue}
                                  </Td>
                                  <Td
                                    align="right"
                                    className="tabular text-2xs"
                                  >
                                    {c.weight}
                                  </Td>
                                  <Td align="right">
                                    <span
                                      className={
                                        c.agreed ? "text-ok" : "text-danger"
                                      }
                                    >
                                      {c.agreed ? "✓" : "✗"}
                                    </span>
                                  </Td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </div>
                      </div>

                      <div>
                        <p className="text-2xs uppercase tracking-wide text-ink-muted">
                          Policy that blocked auto-resolution
                        </p>
                        <div className="mt-2 space-y-1">
                          {openRow.evidence.trace.map((t, i) => (
                            <div
                              key={i}
                              className="flex flex-wrap items-baseline gap-2 text-2xs"
                            >
                              <span
                                className={cn(
                                  "rounded border px-1.5 py-0.5 text-[10px] uppercase",
                                  KIND_STYLE[t.kind] ??
                                    "border-white/15 text-ink-muted"
                                )}
                              >
                                {t.kind}
                              </span>
                              <span className="mono text-ink-body">
                                {t.stage}
                              </span>
                              <span className="text-ink-faint">{t.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : null}

                  <div className="rounded-lg border border-ok/25 bg-ok/[0.07] px-4 py-3">
                    <p className="text-2xs uppercase tracking-wide text-ok">
                      Recommended action
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-body">
                      {openRow.recommendedAction}
                    </p>
                  </div>

                  {/* The decision itself. */}
                  {openRow.status === "OPEN" ? (
                    <div className="rounded-lg border border-rule-strong bg-paper-sunken px-4 py-4">
                      <p className="text-[13px] font-medium text-ink-strong">
                        Record a decision
                      </p>

                      <label className="mt-3 block">
                        <span className="text-2xs uppercase tracking-wide text-ink-muted">
                          Review note
                        </span>
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={2}
                          placeholder="Required for everything except a plain acceptance."
                          className="focusable mt-1 w-full rounded-md border border-rule-strong bg-surface-sunken px-3 py-2 text-[13px] text-ink-body placeholder:text-ink-faint"
                        />
                      </label>

                      <label className="mt-2 block">
                        <span className="text-2xs uppercase tracking-wide text-ink-muted">
                          Link a different settlement (for Relink)
                        </span>
                        <input
                          value={linkedId}
                          onChange={(e) => setLinkedId(e.target.value)}
                          placeholder="ext_0123a"
                          className="focusable mono mt-1 w-full rounded-md border border-rule-strong bg-surface-sunken px-3 py-2 text-[13px] text-ink-body placeholder:text-ink-faint"
                        />
                      </label>

                      {actionError ? (
                        <p className="mt-3 rounded-md border border-danger/30 bg-danger/[0.10] px-3 py-2 text-2xs text-danger">
                          {actionError}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {Object.entries(actions).map(([key, spec]) => (
                          <button
                            key={key}
                            type="button"
                            disabled={submitting}
                            title={spec.description}
                            onClick={() => act(openRow.id, key)}
                            className={cn(
                              "focusable btn-lift rounded-lg border px-3 py-2 text-[13px] font-medium transition-transform disabled:opacity-50",
                              key === "ACCEPTED"
                                ? "border-ok/35 bg-ok/[0.12] text-ok"
                                : key === "FROZEN"
                                  ? "border-brand/35 bg-brand/[0.12] text-brand"
                                  : "border-rule-strong bg-paper-sunken text-ink-body"
                            )}
                          >
                            {spec.label}
                            {spec.requiresNote ? (
                              <span className="ml-1 text-[10px] text-ink-faint">
                                (note required)
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-rule-strong bg-paper-sunken px-4 py-3">
                      <p className="text-2xs uppercase tracking-wide text-ink-muted">
                        Decision recorded
                      </p>
                      <p className="mt-1 text-[13px] text-ink-strong">
                        {openRow.status.replace(/_/g, " ")} by{" "}
                        {openRow.reviewerId ?? "unknown"}
                        {openRow.reviewedAt
                          ? ` on ${new Date(openRow.reviewedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
                          : ""}
                      </p>
                      {openRow.reviewNote ? (
                        <p className="mt-1 text-2xs leading-relaxed text-ink-body">
                          “{openRow.reviewNote}”
                        </p>
                      ) : null}
                      {openRow.linkedExternalId ? (
                        <p className="mt-1 text-2xs text-ink-faint">
                          Linked to{" "}
                          <span className="mono">
                            {openRow.linkedExternalId}
                          </span>
                        </p>
                      ) : null}
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => act(openRow.id, "REOPEN")}
                        className="focusable mt-3 rounded-md border border-rule-strong bg-paper-sunken px-3 py-1.5 text-2xs text-ink-body disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    </div>
                  )}

                  <div className="rounded-lg border border-rule bg-paper-sunken px-4 py-3">
                    <p className="text-2xs uppercase tracking-wide text-ink-muted">
                      Ground truth ({openRow.evidence?.groundTruthLabel})
                    </p>
                    <p className="mt-1 text-2xs leading-relaxed text-ink-faint">
                      {openRow.evidence?.groundTruthNote}
                    </p>
                    <p className="mt-2 text-2xs text-ink-faint">
                      Value at stake if mishandled:{" "}
                      <Money
                        paise={openRow.evidence?.materialityPaise ?? 0}
                      />
                    </p>
                  </div>
                </CardBody>
              </Card>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
