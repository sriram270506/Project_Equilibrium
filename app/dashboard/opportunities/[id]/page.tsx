"use client";
"use client";

import { useEffect, useState, use } from "react";
import { formatPaise } from "@/src/lib/money";
import { useRouter } from "next/navigation";

interface OpportunityDetail {
  id: string;
  supplier: { id: string; name: string; email: string; riskTier: string };
  predictionProbability: number;
  modelVersion: string;
  policyVersion: string;
  expectedBenefitPaise: number;
  opportunityCostPaise: number;
  riskCostPaise: number;
  expectedValuePaise: number;
  recommendedDiscountBps: number;
  maxAllowedDiscountPaise: number;
  status: string;
  decisionReason: string;
  createdAt: string;
}

export default function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const [opportunity, setOpportunity] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    const fetchOpportunity = async () => {
      try {
        const res = await fetch(`/api/opportunities/${resolvedParams.id}`);
        const data = await res.json();
        if (data.success) {
          setOpportunity(data.data);
        } else {
          setError(data.error?.message || "Failed to fetch");
        }
      } catch (err) {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchOpportunity();
  }, [resolvedParams.id]);

  const handleApprove = async () => {
    if (!opportunity) return;
    setApproving(true);

    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId: "demo-finance-operator" }),
      });

      const data = await res.json();
      if (data.success) {
        alert(
          `Opportunity approved! Payment Intent: ${data.data.paymentIntentId}`
        );
        router.push("/dashboard/payments");
      } else {
        setError(data.error?.message || "Failed to approve");
      }
    } catch (err) {
      setError("Network error during approval");
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading opportunity...</div>;
  }

  if (!opportunity) {
    return (
      <div className="text-center py-8 text-red-600">Opportunity not found</div>
    );
  }

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => router.back()}
        className="mb-6 text-blue-600 hover:text-blue-700"
      >
        ← Back
      </button>

      <div className="bg-white rounded-lg shadow p-8">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {opportunity.supplier.name}
            </h1>
            <p className="text-slate-600">{opportunity.supplier.email}</p>
          </div>
          <span
            className={`px-4 py-2 rounded-full text-lg font-semibold ${
              opportunity.status === "RECOMMENDED"
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-900"
            }`}
          >
            {opportunity.status}
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-8 mb-8">
          <section>
            <h2 className="text-xl font-semibold mb-4">Model Prediction</h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-600">Probability</p>
                <p className="text-2xl font-bold text-emerald-600">
                  {(opportunity.predictionProbability * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Model Version</p>
                <p className="text-sm font-mono">{opportunity.modelVersion}</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">Economic Analysis</h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-600">Expected Value</p>
                <p className="text-2xl font-bold text-emerald-600">
                  {formatPaise(opportunity.expectedValuePaise)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Discount Recommended</p>
                <p className="text-lg font-semibold">
                  {opportunity.recommendedDiscountBps} bps (1-{opportunity.recommendedDiscountBps / 100}%)
                </p>
              </div>
            </div>
          </section>
        </div>

        <section className="mb-8 bg-slate-50 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Policy Evaluation</h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-slate-600">Expected Benefit</p>
              <p className="text-lg font-semibold">
                {formatPaise(opportunity.expectedBenefitPaise)}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Opportunity Cost</p>
              <p className="text-lg font-semibold">
                {formatPaise(opportunity.opportunityCostPaise)}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Risk Cost</p>
              <p className="text-lg font-semibold">
                {formatPaise(opportunity.riskCostPaise)}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Max Allowed Discount</p>
              <p className="text-lg font-semibold">
                {formatPaise(opportunity.maxAllowedDiscountPaise)}
              </p>
            </div>
          </div>
        </section>

        <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <p className="text-sm font-semibold text-blue-900 mb-2">
            Policy Decision
          </p>
          <p className="text-sm text-blue-800">{opportunity.decisionReason}</p>
        </div>

        {opportunity.status === "RECOMMENDED" && (
          <button
            onClick={handleApprove}
            disabled={approving}
            className="w-full px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {approving ? "Approving..." : "Approve Opportunity"}
          </button>
        )}
      </div>
    </div>
  );
}
