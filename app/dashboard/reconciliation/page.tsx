"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardBody,
  PageHeader,
  Button,
  Money,
  Callout,
  Stat,
  MonoId,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/src/components/ui/primitives";
import { StatusChip, SeverityBadge, statusMeaning } from "@/src/components/ui/status";
import { cn } from "@/src/lib/utils";

interface ReconCase {
  id: string;
  outcome: string;
  severity: string;
  status: string;
  internalAmountPaise: number;
  externalAmountPaise: number | null;
  differencePaise: number | null;
  correlationId: string;
  providerReference: string;
  createdAt: string;
  paymentIntentId: string | null;
  supplierName: string | null;
  paymentStatus: string | null;
}

export default function ExceptionsPage() {
  const [cases, setCases] = useState<ReconCase[]>([]);
  const [summary, setSummary] = useState({
    openCritical: 0,
    openWarning: 0,
    openInfo: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reconciliation${filter === "open" ? "?status=open" : ""}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json.success) {
        setCases(json.data.cases);
        setSummary(json.data.summary);
      } else {
        setError(json.error?.message ?? "Failed to load exceptions");
      }
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function runReconciliation() {
    setRunning(true);
    setRunMessage(null);
    try {
      const res = await fetch("/api/reconciliation/run", { method: "POST" });
      const json = await res.json();
      setRunMessage(
        json.success
          ? `Swept every non-terminal payment. ${json.data.casesCreatedOrUpdated} case${json.data.casesCreatedOrUpdated === 1 ? "" : "s"} created or updated.`
          : (json.error?.message ?? "Reconciliation failed")
      );
      await load();
    } catch {
      setRunMessage("Could not reach the API.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fade-up max-w-5xl">
      <PageHeader
        title="Exceptions"
        lede="Every place our books and the payment provider disagree. Reconciliation never guesses: it compares amount and status field by field, repairs only the one case that is provably safe, and raises everything else for a human."
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFilter(filter === "open" ? "all" : "open")}
            >
              {filter === "open" ? "Show all" : "Show open only"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={runReconciliation}
              disabled={running}
            >
              {running ? "Reconciling…" : "Run reconciliation"}
            </Button>
          </div>
        }
      />

      {runMessage ? (
        <div className="mb-4">
          <Callout tone="info">{runMessage}</Callout>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat
          label="Critical"
          value={summary.openCritical}
          tone={summary.openCritical > 0 ? "danger" : "ok"}
          hint="Money may be missing or duplicated"
          emphasis={summary.openCritical > 0}
        />
        <Stat
          label="Warning"
          value={summary.openWarning}
          tone={summary.openWarning > 0 ? "warn" : "ok"}
          hint="States disagree, amounts match"
        />
        <Stat
          label="Informational"
          value={summary.openInfo}
          tone="ok"
          hint="Resolved automatically"
        />
      </div>

      {loading ? (
        <LoadingState label="Loading exceptions" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : cases.length === 0 ? (
        <EmptyState title="Nothing to investigate">
          {filter === "open"
            ? "Our records and the provider agree on every payment. Run reconciliation again after injecting a failure to see a case appear."
            : "No reconciliation cases have been raised yet. Run reconciliation to compare every payment against the provider."}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const disagrees = c.outcome !== "MATCHED";
            return (
              <Card
                key={c.id}
                className={cn(
                  c.severity === "CRITICAL" && c.status !== "RESOLVED"
                    ? "border-danger/35"
                    : c.severity === "WARNING" && c.status !== "RESOLVED"
                      ? "border-warn/35"
                      : undefined
                )}
              >
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={c.severity} />
                        <StatusChip status={c.outcome} size="sm" />
                        <StatusChip status={c.status} size="sm" />
                      </div>
                      <p className="mt-2 text-[15px] font-medium text-ink-strong">
                        {c.supplierName ?? "Unknown supplier"}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
                        {statusMeaning(c.outcome)}
                      </p>
                    </div>

                    {c.paymentIntentId ? (
                      <Link
                        href={`/dashboard/payments/${c.paymentIntentId}`}
                        className="focusable shrink-0 rounded-md border border-line-strong bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
                      >
                        Open payment
                      </Link>
                    ) : null}
                  </div>

                  {/* The disagreement, side by side. */}
                  <div className="grid gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft sm:grid-cols-3">
                    <div className="bg-surface-card px-4 py-3">
                      <p className="text-2xs font-medium text-ink-muted">
                        Our books say
                      </p>
                      <p className="tabular mt-1 text-sm font-semibold text-ink-strong">
                        <Money paise={c.internalAmountPaise} />
                      </p>
                      {c.paymentStatus ? (
                        <p className="mt-1 text-2xs text-ink-muted">
                          {c.paymentStatus}
                        </p>
                      ) : null}
                    </div>
                    <div className="bg-surface-card px-4 py-3">
                      <p className="text-2xs font-medium text-ink-muted">
                        Provider says
                      </p>
                      <p className="tabular mt-1 text-sm font-semibold text-ink-strong">
                        {c.externalAmountPaise === null ? (
                          <span className="text-danger">no record</span>
                        ) : (
                          <Money paise={c.externalAmountPaise} />
                        )}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "px-4 py-3",
                        c.differencePaise
                          ? "bg-danger/[0.12]"
                          : "bg-surface-card"
                      )}
                    >
                      <p className="text-2xs font-medium text-ink-muted">
                        Difference
                      </p>
                      <p
                        className={cn(
                          "tabular mt-1 text-sm font-semibold",
                          c.differencePaise ? "text-danger" : "text-ok"
                        )}
                      >
                        {c.differencePaise === null ? (
                          "—"
                        ) : (
                          <Money paise={c.differencePaise} />
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-2xs text-ink-muted">
                    <span>
                      correlation <MonoId value={c.correlationId} truncate={18} />
                    </span>
                    <span>
                      raised{" "}
                      {new Date(c.createdAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    {!disagrees ? (
                      <span className="text-ok">
                        Resolved automatically against the provider
                      </span>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
