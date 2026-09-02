"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
}

export default function OfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [data, setData] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

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

  async function approve() {
    setApproving(true);
    setApprovalError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId: "priya.raman" }),
      });
      const json = await res.json();
      if (json.success) {
        router.push(`/dashboard/payments/${json.data.paymentIntentId}`);
      } else {
        setApprovalError(json.error?.message ?? "Approval failed");
      }
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
        className="focusable mb-3 inline-flex text-[13px] font-medium text-brand-strong hover:underline"
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

      <div className="mb-4">
        <RunwayChart observations={observations} supplierName={supplier.name} />
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
                  className="focusable text-[13px] font-medium text-brand-strong hover:underline"
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
