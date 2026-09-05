"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardBody,
  CardHeader,
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
import { ControllerTrace } from "@/src/components/controller-trace";
import { cn } from "@/src/lib/utils";

/**
 * The controller console.
 *
 * Previously this was a text input you had to type an invoice id into, plus a
 * JSON dump of the result. You could not discover what to review, and you could
 * not tell whether the output reflected anything the system actually did.
 *
 * Now: a priced queue you pick from, and a step-by-step trace of the real tool
 * calls behind every recommendation.
 */

interface AnomalyCost {
  code: string;
  label: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  exposurePaise: number;
  certainty: "EXACT" | "ESTIMATED" | "CONTINGENT";
  basis: string;
}

interface Counterfactual {
  code: string;
  change: string;
  actionable: "FIXABLE_BY_US" | "NEEDS_VENDOR" | "NEEDS_JUDGEMENT";
}

interface InvoiceRow {
  id: string;
  vendorName: string;
  vendorGstin: string;
  invoiceNumber: string;
  totalPaise: number;
  anomalyRisk: string;
  anomalyScore: number;
  reasonCodes: string[];
  explanation: string | null;
  termsDays: number | null;
  counterfactuals: Counterfactual[];
  exposure: {
    exactPaise: number;
    totalPaise: number;
    costs: AnomalyCost[];
  };
}

interface Summary {
  invoicesReviewed: number;
  invoicesFlagged: number;
  exactPreventedPaise: number;
  totalPreventedPaise: number;
  byCode: Array<{ code: string; label: string; count: number; exposurePaise: number }>;
}

interface TraceResult {
  traceId: string;
  status: "COMPLETED" | "STOPPED";
  recommendation: string;
  stopReason: string | null;
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    status: "SUCCEEDED" | "STOPPED";
  }>;
  facts: Record<string, unknown>;
}

export default function ControllerPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/invoices", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setInvoices(json.data.invoices);
        setSummary(json.data.summary);
      } else {
        setLoadError(json.error?.message ?? "Failed to load the invoice queue");
      }
    } catch {
      setLoadError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runController(invoiceId: string) {
    setSelected(invoiceId);
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const res = await fetch("/api/controller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const json = await res.json();
      if (json.success) setResult(json.data);
      else setRunError(json.error?.message ?? "Controller run failed");
    } catch {
      setRunError("Could not reach the API.");
    } finally {
      setRunning(false);
    }
  }

  const selectedInvoice = invoices.find((i) => i.id === selected) ?? null;

  return (
    <div className="fade-up max-w-6xl">
      <PageHeader
        title="AI finance controller"
        lede="The controller reads financial evidence with typed, read-only tools and proposes the next safe operation. It cannot approve, submit, post to the ledger, or resolve an exception — those remain with an operator."
        action={
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh queue
          </Button>
        }
      />

      {/* What reviewing this queue is worth, in money. */}
      {summary ? (
        <div className="stagger mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Invoices in queue"
            value={summary.invoicesReviewed}
            hint={`${summary.invoicesFlagged} carry at least one defect`}
          />
          <Stat
            label="Exposure, certain"
            value={<Money paise={summary.exactPreventedPaise} />}
            tone="danger"
            hint="Arithmetic and tax-credit losses we can state to the rupee"
            emphasis
          />
          <Stat
            label="Exposure, including contingent"
            value={<Money paise={summary.totalPreventedPaise} />}
            tone="warn"
            hint="Adds duplicates and outliers, which may prove legitimate"
          />
          <Stat
            label="Largest single risk"
            value={summary.byCode[0]?.label.split(" ").slice(0, 3).join(" ") ?? "—"}
            tone="warn"
            hint={
              summary.byCode[0]
                ? `${summary.byCode[0].count} invoice(s)`
                : "nothing flagged"
            }
          />
        </div>
      ) : null}

      <Callout tone="info" title="Certain and contingent are kept apart on purpose">
        A Rs 9,000 arithmetic error is a fact. A near-duplicate that might be a
        genuine second order is not. Blending them into one headline figure
        would inflate the number and destroy the credibility of every other
        figure on this page.
      </Callout>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ------------------------------------------------------- queue -- */}
        <div>
          <p className="eyebrow mb-3">Review queue, ordered by exposure</p>

          {loading ? (
            <LoadingState label="Loading invoices" />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : invoices.length === 0 ? (
            <EmptyState title="No invoices">
              Run <span className="mono">npm run db:seed</span> to load the
              twelve-invoice fixture set.
            </EmptyState>
          ) : (
            <ol className="space-y-2.5">
              {[...invoices]
                .sort((a, b) => b.exposure.totalPaise - a.exposure.totalPaise)
                .map((invoice) => {
                  const isSelected = invoice.id === selected;
                  const clean =
                    invoice.reasonCodes.length === 1 &&
                    invoice.reasonCodes[0] === "NO_VENDOR_HISTORY";

                  return (
                    <li key={invoice.id}>
                      <button
                        type="button"
                        onClick={() => runController(invoice.id)}
                        disabled={running}
                        className={cn(
                          "focusable glass glass-interactive w-full rounded-card p-4 text-left ",
                          isSelected && "glass-accent",
                          running && !isSelected && "opacity-50"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-[14px] font-medium text-ink-strong">
                              {invoice.vendorName}
                              <MonoId value={invoice.id} />
                            </p>
                            <p className="mt-0.5 text-2xs text-ink-faint">
                              {invoice.invoiceNumber}
                              {invoice.termsDays !== null
                                ? ` · ${invoice.termsDays}-day terms`
                                : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="tabular text-sm font-semibold text-ink-strong">
                              <Money paise={invoice.totalPaise} />
                            </p>
                            {!clean ? (
                              <p className="tabular mt-0.5 text-2xs text-danger">
                                <Money paise={invoice.exposure.totalPaise} /> at
                                risk
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <RiskPill risk={invoice.anomalyRisk} score={invoice.anomalyScore} />
                          {invoice.reasonCodes
                            .filter((c) => c !== "NO_VENDOR_HISTORY")
                            .map((code) => (
                              <span
                                key={code}
                                className="mono rounded border border-rule-strong bg-paper-sunken px-1.5 py-0.5 text-[10px] text-ink-muted"
                              >
                                {code}
                              </span>
                            ))}
                          {clean ? (
                            <span className="text-2xs text-ok">
                              no defects found
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
            </ol>
          )}
        </div>

        {/* ------------------------------------------------------- trace -- */}
        <div className="space-y-4">
          <p className="eyebrow mb-3">Controller run</p>

          {!selected ? (
            <EmptyState title="Pick an invoice">
              Select one from the queue. The controller will read it with typed,
              read-only tools and show every call it makes.
            </EmptyState>
          ) : running ? (
            <LoadingState label={`Running the controller over ${selected}`} />
          ) : runError ? (
            <ErrorState
              message={runError}
              onRetry={() => runController(selected)}
            />
          ) : result ? (
            <>
              {/* What this specific invoice costs, itemised. */}
              {selectedInvoice && selectedInvoice.exposure.costs.length > 0 ? (
                <Card>
                  <CardHeader
                    eyebrow="Exposure on this invoice"
                    title="What each defect costs"
                    hint="Derived from the rule it breaks, not from a severity label."
                  />
                  <CardBody className="space-y-2.5">
                    {selectedInvoice.exposure.costs
                      .filter((c) => c.code !== "NO_VENDOR_HISTORY")
                      .map((cost) => (
                        <div
                          key={cost.code}
                          className="rounded-lg border border-rule bg-paper-sunken px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[14px] font-medium text-ink-strong">
                                {cost.label}
                              </p>
                              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                                {cost.basis}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p
                                className={cn(
                                  "tabular text-sm font-semibold",
                                  cost.exposurePaise > 0
                                    ? "text-danger"
                                    : "text-ink-faint"
                                )}
                              >
                                {cost.exposurePaise > 0 ? (
                                  <Money paise={cost.exposurePaise} />
                                ) : (
                                  "no cash loss"
                                )}
                              </p>
                              <span
                                className={cn(
                                  "mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                  cost.certainty === "EXACT"
                                    ? "border-danger/35 bg-danger/[0.12] text-danger"
                                    : "border-warn/30 bg-warn/[0.10] text-warn"
                                )}
                              >
                                {cost.certainty.toLowerCase()}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </CardBody>
                </Card>
              ) : null}

              {/* What would have to change - the question an operator asks
                  when they disagree with a finding. */}
              {selectedInvoice && selectedInvoice.counterfactuals.length > 0 ? (
                <Card>
                  <CardHeader
                    eyebrow="Counterfactual"
                    title="What would clear each flag"
                    hint="Separated by who can act: some we can fix ourselves, some need the vendor, some need a judgement call."
                  />
                  <CardBody className="space-y-2.5">
                    {selectedInvoice.counterfactuals.map((cf) => (
                      <div
                        key={cf.code}
                        className="rounded-lg border border-rule bg-paper-sunken px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[13px] leading-relaxed text-ink-body">
                            {cf.change}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              cf.actionable === "FIXABLE_BY_US" &&
                                "border-ok/35 bg-ok/[0.12] text-ok",
                              cf.actionable === "NEEDS_VENDOR" &&
                                "border-warn/35 bg-warn/[0.12] text-warn",
                              cf.actionable === "NEEDS_JUDGEMENT" &&
                                "border-info/35 bg-info/[0.12] text-info"
                            )}
                          >
                            {cf.actionable.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardBody>
                </Card>
              ) : null}

              <ControllerTrace
                traceId={result.traceId}
                status={result.status}
                recommendation={result.recommendation}
                stopReason={result.stopReason}
                toolCalls={result.toolCalls}
                facts={result.facts}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RiskPill({ risk, score }: { risk: string; score: number }) {
  const tone =
    risk === "HIGH" ? "danger" : risk === "MEDIUM" ? "warn" : "ok";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-medium",
        tone === "danger" && "border-danger/35 bg-danger/[0.12] text-danger",
        tone === "warn" && "border-warn/35 bg-warn/[0.12] text-warn",
        tone === "ok" && "border-ok/35 bg-ok/[0.12] text-ok"
      )}
    >
      {risk.toLowerCase()} · {score}
    </span>
  );
}
