"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardBody,
  Stat,
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
import { StatusChip } from "@/src/components/ui/status";
import { RiskBar } from "@/src/components/explainability";
import {
  PortfolioExposure,
  type PortfolioForecast,
} from "@/src/components/portfolio-exposure";

interface DashboardData {
  headline: {
    suppliersAtRisk: number;
    atRiskExposurePaise: number;
    mostUrgent: {
      opportunityId: string;
      supplierName: string;
      probability: number;
      amountPaise: number;
    } | null;
  };
  kpis: {
    suppliersAtRisk: number;
    offersApproved: number;
    cashAdvancedPaise: number;
    suppliersHelped: number;
    openExceptions: number;
    criticalExceptions: number;
    paymentsNeedingAttention: number;
    pendingOutboxEvents: number;
  };
  portfolioForecast: PortfolioForecast;
  integrity: {
    ledgerBalanced: boolean;
    totalDebitsPaise: number;
    totalCreditsPaise: number;
    netPaise: number;
    accountCount: number;
  };
  paymentsByStatus: Record<string, number>;
  recentPayments: Array<{
    id: string;
    supplierName: string;
    amountPaise: number;
    status: string;
    correlationId: string;
    createdAt: string;
  }>;
  systemHealth: { status: string; mode: string; provider: string };
}

export default function OverviewPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message ?? "Failed to load overview");
      }
    } catch {
      setError("Could not reach the API. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="Loading today's position" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { headline, kpis, integrity, recentPayments, portfolioForecast } = data;

  return (
    <div className="fade-up max-w-6xl">
      <PageHeader
        title="Overview"
        lede="Which suppliers are about to run short, what we have advanced them, and whether the books still foot."
        action={
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
        }
      />

      {/* The one sentence that matters right now. */}
      {headline.suppliersAtRisk > 0 && headline.mostUrgent ? (
        <Callout tone="warn" title="Needs a decision today">
          <p>
            <strong>{headline.suppliersAtRisk}</strong>{" "}
            {headline.suppliersAtRisk === 1 ? "supplier is" : "suppliers are"}{" "}
            projected to run short of cash within seven days, representing{" "}
            <Money paise={headline.atRiskExposurePaise} /> in early-payment
            offers awaiting approval. The most urgent is{" "}
            <strong>{headline.mostUrgent.supplierName}</strong> at{" "}
            {(headline.mostUrgent.probability * 100).toFixed(0)}% risk.
          </p>
          <Link
            href="/dashboard/opportunities"
            className="focusable mt-3 inline-flex rounded-md bg-brand-deep px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand"
          >
            Review suppliers at risk
          </Link>
        </Callout>
      ) : (
        <Callout tone="ok" title="No suppliers currently at risk">
          Every supplier has adequate projected runway. New observations are
          scored as they arrive.
        </Callout>
      )}

      {/* Outcomes, not entity counts. */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Suppliers at risk"
          value={kpis.suppliersAtRisk}
          tone={kpis.suppliersAtRisk > 0 ? "warn" : "ok"}
          hint="Projected to run short within 7 days"
          emphasis={kpis.suppliersAtRisk > 0}
        />
        <Stat
          label="Cash advanced"
          value={<Money paise={kpis.cashAdvancedPaise} />}
          tone="ok"
          hint={`Paid early to ${kpis.suppliersHelped} ${
            kpis.suppliersHelped === 1 ? "supplier" : "suppliers"
          }`}
        />
        <Stat
          label="Payments needing attention"
          value={kpis.paymentsNeedingAttention}
          tone={kpis.paymentsNeedingAttention > 0 ? "warn" : "ok"}
          hint="Unknown outcome or held for review"
        />
        <Stat
          label="Open exceptions"
          value={kpis.openExceptions}
          tone={
            kpis.criticalExceptions > 0
              ? "danger"
              : kpis.openExceptions > 0
                ? "warn"
                : "ok"
          }
          hint={
            kpis.criticalExceptions > 0
              ? `${kpis.criticalExceptions} critical`
              : "Where we and the provider disagree"
          }
        />
      </div>

      {/* What approving everything would commit, and whether we can fund it. */}
      {portfolioForecast && portfolioForecast.curve.length > 0 ? (
        <div className="mt-4">
          <PortfolioExposure forecast={portfolioForecast} />
        </div>
      ) : null}

      {/* The integrity claim, stated plainly and checked live. */}
      <div className="mt-4">
        <Card
          className={
            integrity.ledgerBalanced
              ? "border-ok/30 bg-ok/[0.12]"
              : "border-danger/40 bg-danger/[0.12]"
          }
        >
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${
                  integrity.ledgerBalanced
                    ? "bg-ok text-white"
                    : "bg-danger text-white"
                }`}
              >
                {integrity.ledgerBalanced ? "✓" : "!"}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-strong">
                  {integrity.ledgerBalanced
                    ? "The books balance"
                    : "Ledger is out of balance"}
                </p>
                <p className="tabular mt-0.5 text-[13px] text-ink-body">
                  <Money paise={integrity.totalDebitsPaise} /> debits ={" "}
                  <Money paise={integrity.totalCreditsPaise} /> credits across{" "}
                  {integrity.accountCount} accounts
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/ledger"
              className="focusable rounded-md border border-line-strong bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
            >
              Open trial balance
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* Recent money movement. */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Recent money movement"
            hint="Every payment carries a correlation id that threads it through the ledger, the event log, and reconciliation."
            action={
              <Link
                href="/dashboard/payments"
                className="focusable text-[13px] font-medium text-brand-bright hover:underline"
              >
                View all
              </Link>
            }
          />
          {recentPayments.length === 0 ? (
            <EmptyState title="No payments yet">
              Approve an offer from{" "}
              <Link
                href="/dashboard/opportunities"
                className="font-medium text-brand-bright hover:underline"
              >
                suppliers at risk
              </Link>
              , or run the{" "}
              <Link
                href="/dashboard/demo"
                className="font-medium text-brand-bright hover:underline"
              >
                guided walkthrough
              </Link>{" "}
              to generate the full story end to end.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th align="right">Amount</Th>
                  <Th>State</Th>
                  <Th>Correlation</Th>
                  <Th align="right">Created</Th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-sunken">
                    <Td>
                      <Link
                        href={`/dashboard/payments/${p.id}`}
                        className="focusable font-medium text-ink-strong hover:text-brand-bright hover:underline"
                      >
                        {p.supplierName}
                      </Link>
                    </Td>
                    <Td align="right" className="font-medium text-ink-strong">
                      <Money paise={p.amountPaise} />
                    </Td>
                    <Td>
                      <StatusChip status={p.status} size="sm" />
                    </Td>
                    <Td>
                      <MonoId value={p.correlationId} truncate={14} />
                    </Td>
                    <Td align="right" className="tabular text-2xs text-ink-muted">
                      {new Date(p.createdAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* Risk snapshot for the most urgent supplier. */}
      {headline.mostUrgent ? (
        <div className="mt-6">
          <Card>
            <CardHeader
              eyebrow="Most urgent"
              title={headline.mostUrgent.supplierName}
              hint="Highest predicted probability of a cash shortfall in the next seven days."
              action={
                <Link
                  href={`/dashboard/opportunities/${headline.mostUrgent.opportunityId}`}
                  className="focusable rounded-md bg-brand-deep px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand"
                >
                  Review and decide
                </Link>
              }
            />
            <CardBody className="flex flex-wrap items-center gap-8">
              <RiskBar
                probability={headline.mostUrgent.probability}
                label="shortfall risk"
              />
              <div>
                <p className="text-2xs text-ink-muted">Offer size</p>
                <p className="tabular text-lg font-semibold text-ink-strong">
                  <Money paise={headline.mostUrgent.amountPaise} />
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
