"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Button,
  Money,
  Callout,
  DataRow,
  MonoId,
  LoadingState,
  ErrorState,
} from "@/src/components/ui/primitives";
import { StatusChip } from "@/src/components/ui/status";
import { ExplanationPanel } from "@/src/components/explainability";
import { DealMathCard } from "@/src/components/deal-math";
import { RunwayChart } from "@/src/components/runway-chart";
import { ForecastChart } from "@/src/components/forecast-chart";
import { RateBenchmarkCard } from "@/src/components/rate-benchmark";
import {
  ApprovalEffect,
  type EffectDelta,
} from "@/src/components/approval-effect";
import type { InterventionComparison } from "@/src/lib/forecast/cash-projection";
import type { RateBenchmark } from "@/src/lib/benchmark/market-data";
import { PredictionExplanation } from "@/src/lib/ml/explain";
import { DealEconomics } from "@/src/lib/deal-economics";

interface OfferDetail {
  opportunity: {
    id: string;
    status: string;
    probability: number;
    modelVersion: string;
    policyVersion: string;
    decisionReason: string;
    expectedValuePaise: number;
    expectedBenefitPaise: number;
    opportunityCostPaise: number;
    riskCostPaise: number;
    recommendedDiscountBps: number;
    createdAt: string;
  };
  supplier: {
    id: string;
    name: string;
    email: string;
    riskTier: string;
    since: string;
  };
  explanation: PredictionExplanation;
  comparison: {
    modelTriggered: boolean;
    baselineTriggered: boolean;
    agree: boolean;
    recommendation: string;
    reasoning: string;
  };
  deal: DealEconomics;
  observations: Array<{
    date: string;
    balancePaise: number;
    inflowPaise: number;
    outflowPaise: number;
    daysRunway: number;
  }>;
  payment: { id: string; status: string; correlationId: string } | null;
  forecast: InterventionComparison | null;
  rateBenchmark: RateBenchmark;
}

export default function OfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [data, setData] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [effect, setEffect] = useState<EffectDelta | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.error?.message ?? "Failed to load this offer");
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Approve, then SHOW THE EFFECT rather than navigating away.
   *
   * This used to router.push() straight to the payment page, so the single most
   * consequential action in the product produced a page transition and nothing
   * else. State is snapshotted before and after so the panel can show what
   * actually moved: the journal posted, the portfolio commitment, the
   * supplier's forecast.
   */
  async function approve() {
    if (!data) return;
    setApproving(true);
    setApprovalError(null);
    setEffect(null);

    try {
      // Snapshot the portfolio before we change it.
      const beforeRes = await fetch("/api/dashboard", { cache: "no-store" });
      const beforeJson = await beforeRes.json();
      const exposureBefore = beforeJson.success
        ? beforeJson.data.portfolioForecast.peakExposurePaise
        : 0;
      const exposureLimit = beforeJson.success
        ? beforeJson.data.portfolioForecast.dailyLimitPaise
        : 0;

      const res = await fetch(`/api/opportunities/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();

      if (!json.success) {
        setApprovalError(json.error?.message ?? "Approval failed");
        return;
      }

      // Read back what changed: the journal, and the new portfolio position.
      const [paymentRes, afterRes] = await Promise.all([
        fetch(`/api/payments/${json.data.paymentIntentId}`, {
          cache: "no-store",
        }),
        fetch("/api/dashboard", { cache: "no-store" }),
      ]);
      const paymentJson = await paymentRes.json();
      const afterJson = await afterRes.json();

      setEffect({
        ledgerLegs: paymentJson.success
          ? paymentJson.data.ledger.entries.map(
              (e: { accountCode: string; debitPaise: number; creditPaise: number }) => ({
                accountCode: e.accountCode,
                debitPaise: e.debitPaise,
                creditPaise: e.creditPaise,
              })
            )
          : [],
        ledgerBalanced: paymentJson.success
          ? paymentJson.data.ledger.balanced
          : false,
        exposureBeforePaise: exposureBefore,
        exposureAfterPaise: afterJson.success
          ? afterJson.data.portfolioForecast.peakExposurePaise
          : exposureBefore,
        exposureLimitPaise: exposureLimit,
        runwayBeforeDay: data.forecast?.baseline.medianZeroCrossingDay ?? null,
        runwayAfterDay: data.forecast?.withAdvance.medianZeroCrossingDay ?? null,
        paymentIntentId: json.data.paymentIntentId,
        paymentStatus: json.data.status,
        requiresDualApproval: Boolean(json.data.requiresDualApproval),
        amountPaise: data.opportunity.expectedBenefitPaise,
        supplierName: data.supplier.name,
      });

      // Refresh the page data so the status chip and policy card reflect
      // the new state without a navigation.
      await load();
    } catch {
      setApprovalError("Could not reach the API.");
    } finally {
      setApproving(false);
    }
  }

  if (loading) return <LoadingState label="Loading the offer" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { opportunity, supplier, explanation, comparison, deal, observations } =
    data;
  const canApprove = opportunity.status === "RECOMMENDED";

  return (
    <div className="fade-up max-w-5xl">
      <Link
        href="/dashboard/opportunities"
        className="focusable mb-3 inline-flex text-[13px] font-medium text-brand-bright hover:underline"
      >
        ← All suppliers at risk
      </Link>

      <PageHeader
        title={supplier.name}
        lede={explanation.summary}
        action={
          <div className="flex flex-col items-end gap-2">
            <StatusChip status={opportunity.status} />
            {canApprove ? (
              <Button variant="primary" onClick={approve} disabled={approving}>
                {approving ? "Approving…" : "Approve and pay"}
              </Button>
            ) : null}
          </div>
        }
      />

      {effect ? (
        <div className="fade-up mb-4">
          <ApprovalEffect delta={effect} />
        </div>
      ) : null}

      {approvalError ? (
        <div className="mb-4">
          <Callout tone="danger" title="Could not approve">
            {approvalError}
          </Callout>
        </div>
      ) : null}

      {/* Where the model and the naive rule disagree is where a human matters. */}
      {!comparison.agree ? (
        <div className="mb-4">
          <Callout tone="warn" title="The model and the simple rule disagree">
            {comparison.reasoning}
          </Callout>
        </div>
      ) : null}

      {data.forecast ? (
        <div className="mb-4">
          <ForecastChart
            projection={data.forecast.baseline}
            comparison={data.forecast}
            supplierName={supplier.name}
          />
        </div>
      ) : null}

      <div className="mb-4">
        <RunwayChart observations={observations} supplierName={supplier.name} />
      </div>

      <div className="mb-4">
        <RateBenchmarkCard benchmark={data.rateBenchmark} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ExplanationPanel
          explanation={explanation}
          threshold={explanation.threshold}
        />
        <DealMathCard deal={deal} supplierName={supplier.name} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Policy verdict"
            hint="The model proposes. Policy decides what may actually be offered."
          />
          <CardBody>
            <p className="mb-3 text-[14px] leading-relaxed text-ink-body">
              {opportunity.decisionReason}
            </p>
            <DataRow label="Expected benefit" hint="probability-weighted">
              <Money paise={opportunity.expectedBenefitPaise} />
            </DataRow>
            <DataRow label="Less opportunity cost">
              −<Money paise={opportunity.opportunityCostPaise} />
            </DataRow>
            <DataRow label="Less risk cost" hint="weighted by 1 − probability">
              −<Money paise={opportunity.riskCostPaise} />
            </DataRow>
            <DataRow label="Expected value">
              <span
                className={
                  opportunity.expectedValuePaise >= 0
                    ? "text-ok"
                    : "text-danger"
                }
              >
                <Money paise={opportunity.expectedValuePaise} />
              </span>
            </DataRow>
            <DataRow label="Discount applied">
              {(opportunity.recommendedDiscountBps / 100).toFixed(2)}%
            </DataRow>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Provenance"
            hint="Stored with the decision, so it can be reconstructed later."
          />
          <CardBody>
            <DataRow label="Supplier since">
              {new Date(supplier.since).toLocaleDateString("en-IN", {
                dateStyle: "medium",
              })}
            </DataRow>
            <DataRow label="Risk tier">{supplier.riskTier}</DataRow>
            <DataRow label="Model version">
              <MonoId value={opportunity.modelVersion} />
            </DataRow>
            <DataRow label="Policy version">
              <MonoId value={opportunity.policyVersion} />
            </DataRow>
            <DataRow label="Scored at">
              {new Date(opportunity.createdAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </DataRow>
            <DataRow label="Offer id">
              <MonoId value={opportunity.id} truncate={20} />
            </DataRow>
          </CardBody>
        </Card>
      </div>

      {data.payment ? (
        <div className="mt-4">
          <Card>
            <CardHeader
              title="Resulting payment"
              action={
                <Link
                  href={`/dashboard/payments/${data.payment.id}`}
                  className="focusable text-[13px] font-medium text-brand-bright hover:underline"
                >
                  Trace it →
                </Link>
              }
            />
            <CardBody className="flex items-center gap-4">
              <StatusChip status={data.payment.status} />
              <MonoId value={data.payment.correlationId} />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
