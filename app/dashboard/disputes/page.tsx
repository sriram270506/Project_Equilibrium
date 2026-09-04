"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Button,
  Money,
  Callout,
  MonoId,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/src/components/ui/primitives";
import { StatusChip } from "@/src/components/ui/status";
import { cn } from "@/src/lib/utils";

interface DisputeCase {
  id: string;
  providerDisputeId: string;
  reasonCode: string;
  amountPaise: number;
  status: string;
  createdAt: string;
  documentCount: number;
  claimCount: number;
  strongClaims: number;
  weakClaims: number;
  contradictions: number;
  hasDraft: boolean;
  draftStatus: string | null;
}

interface DraftResult {
  draftId: string;
  validationStatus: string;
  validationErrors: string[];
  draftText: string;
}

/** Chargeback reason codes in language a person can act on. */
const REASON_CODES: Record<string, string> = {
  PRODUCT_NOT_RECEIVED: "The buyer says the goods never arrived.",
  PRODUCT_NOT_AS_DESCRIBED: "The buyer says the goods were not as described.",
  DUPLICATE_CHARGE: "The buyer says they were charged twice.",
  FRAUDULENT: "The buyer says they did not authorise the payment.",
  CREDIT_NOT_PROCESSED: "The buyer says a promised refund never arrived.",
};

export default function DisputesPage() {
  const [cases, setCases] = useState<DisputeCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/disputes", { cache: "no-store" });
      const json = await res.json();
      if (json.success) setCases(json.data.cases);
      else setError(json.error?.message ?? "Failed to load disputes");
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generateDraft(id: string) {
    setDrafting(id);
    try {
      const res = await fetch(`/api/disputes/${id}/draft`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setDrafts((prev) => ({ ...prev, [id]: json.data }));
        await load();
      }
    } finally {
      setDrafting(null);
    }
  }

  return (
    <div className="fade-up max-w-4xl">
      <PageHeader
        title="Dispute evidence"
        lede="When a buyer charges back, the platform has a short window to respond with evidence. This assembles a response from the documents on file and refuses to submit one whose claims contradict each other."
      />

      <Callout tone="info" title="Why contradictions matter more than volume">
        Submitting evidence that disagrees with itself is worse than submitting
        less evidence: it hands the issuer a reason to decide against you and
        costs a response you cannot make twice. So the check here is
        consistency, not quantity.
      </Callout>

      <div className="mt-6">
        {loading ? (
          <LoadingState label="Loading dispute cases" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : cases.length === 0 ? (
          <EmptyState title="No disputes on file">
            Chargebacks arrive from the provider. The seed includes one worked
            example with deliberately contradictory evidence.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {cases.map((c) => {
              const draft = drafts[c.id];
              const blocked = c.contradictions > 0;

              return (
                <Card
                  key={c.id}
                  className={cn(blocked && "border-warn/40")}
                >
                  <CardHeader
                    eyebrow={c.reasonCode}
                    title={
                      REASON_CODES[c.reasonCode] ??
                      "Chargeback raised by the buyer"
                    }
                    hint={`Provider reference ${c.providerDisputeId}`}
                    action={
                      <div className="text-right">
                        <p className="tabular text-lg font-semibold text-ink-strong">
                          <Money paise={c.amountPaise} />
                        </p>
                        <div className="mt-1 flex justify-end">
                          <StatusChip status={c.status} size="sm" />
                        </div>
                      </div>
                    }
                  />

                  <CardBody className="space-y-4">
                    {/* Evidence quality at a glance */}
                    <div className="grid gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft sm:grid-cols-4">
                      <EvidenceTile
                        label="Documents"
                        value={c.documentCount}
                        tone="neutral"
                      />
                      <EvidenceTile
                        label="Strong claims"
                        value={c.strongClaims}
                        hint="confidence ≥ 70%"
                        tone="ok"
                      />
                      <EvidenceTile
                        label="Weak claims"
                        value={c.weakClaims}
                        hint="excluded from the draft"
                        tone="neutral"
                      />
                      <EvidenceTile
                        label="Contradictions"
                        value={c.contradictions}
                        hint={
                          c.contradictions > 0 ? "blocks submission" : "none found"
                        }
                        tone={c.contradictions > 0 ? "danger" : "ok"}
                      />
                    </div>

                    {blocked ? (
                      <Callout tone="warn" title="This case cannot be auto-submitted">
                        {c.contradictions} claim
                        {c.contradictions === 1 ? "" : "s"} in the evidence
                        contradict the rest. A person has to resolve the conflict
                        before a response goes to the provider — the system will
                        not paper over it.
                      </Callout>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => generateDraft(c.id)}
                        disabled={drafting === c.id}
                      >
                        {drafting === c.id
                          ? "Assembling…"
                          : draft
                            ? "Regenerate draft"
                            : "Assemble evidence draft"}
                      </Button>
                      {c.draftStatus ? (
                        <StatusChip
                          status={
                            c.draftStatus === "PASSED"
                              ? "DRAFT_READY"
                              : "NEEDS_REVIEW"
                          }
                          size="sm"
                        />
                      ) : null}
                      <MonoId value={c.id} truncate={18} />
                    </div>

                    {draft ? (
                      <div className="fade-up space-y-3">
                        {draft.validationErrors.length > 0 ? (
                          <div className="rounded-md border border-warn/30 bg-warn/[0.12] px-4 py-3">
                            <p className="text-[13px] font-semibold text-ink-strong">
                              Held for review
                            </p>
                            <ul className="mt-1.5 space-y-1">
                              {draft.validationErrors.map((e) => (
                                <li
                                  key={e}
                                  className="text-[13px] leading-relaxed text-ink-body"
                                >
                                  • {e}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div>
                          <p className="eyebrow mb-2">Draft response</p>
                          <pre className="mono overflow-x-auto whitespace-pre-wrap rounded-md border border-line-soft bg-surface-sunken px-4 py-3 text-[12px] leading-relaxed text-ink-body">
                            {draft.draftText}
                          </pre>
                        </div>
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: "ok" | "danger" | "neutral";
}) {
  return (
    <div className="bg-surface-card px-4 py-3">
      <p className="text-2xs font-medium text-ink-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-xl font-semibold",
          tone === "ok" && value > 0 && "text-ok",
          tone === "danger" && value > 0 && "text-danger",
          (tone === "neutral" || value === 0) && "text-ink-strong"
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-2xs leading-snug text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
