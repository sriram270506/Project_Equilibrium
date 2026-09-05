"use client";

import { useEffect, useState } from "react";
import { formatPaise } from "@/src/lib/money";
import Link from "next/link";

interface Opportunity {
  id: string;
  supplierId: string;
  supplierName: string;
  predictionProbability: number;
  expectedValuePaise: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("RECOMMENDED");

  useEffect(() => {
    const fetchOpportunities = async () => {
      try {
        const res = await fetch(
          `/api/opportunities?status=${filter}&limit=50`
        );
        const data = await res.json();
        if (data.success) {
          setOpportunities(data.data.opportunities);
        } else {
          setError(data.error?.message || "Failed to fetch");
        }
      } catch (err) {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchOpportunities();
  }, [filter]);

  if (loading) {
    return <div className="text-center py-8">Loading opportunities...</div>;
  }

  return (
    <div className="max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <h1 className="display text-[34px] leading-[1.1] text-ink-strong">
          Suppliers at risk
        </h1>
        <button
          onClick={() =>
            setFilter(filter === "RECOMMENDED" ? "APPROVED" : "RECOMMENDED")
          }
          className="px-4 py-2 bg-brand text-white rounded-md hover:bg-brand-deep"
        >
          Show {filter === "RECOMMENDED" ? "Approved" : "Recommended"}
        </button>
      </div>

      {error && (
        <div className="bg-danger/[0.10] border border-danger/30 rounded-lg p-4 mb-6 text-danger">
          {error}
        </div>
      )}

      {opportunities.length === 0 ? (
        <div className="bg-paper-sunken border border-rule rounded-lg p-12 text-center">
          <p className="text-ink-muted">No opportunities found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {opportunities.map((opp) => (
            <div
              key={opp.id}
              className="glass  rounded-card p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{opp.supplierName}</h2>
                  <p className="text-sm text-ink-body font-medium">ID: {opp.id}</p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    opp.status === "RECOMMENDED"
                      ? "bg-warn/[0.14] text-warn"
                      : "bg-ok/[0.14] text-ok"
                  }`}
                >
                  {opp.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-sm text-ink-body font-medium">Probability</p>
                  <p className="text-lg font-semibold">
                    {(opp.predictionProbability * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-ink-body font-medium">Expected Value</p>
                  <p className="text-lg font-semibold text-ok">
                    {formatPaise(opp.expectedValuePaise)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-ink-body font-medium">Created</p>
                  <p className="text-sm">
                    {new Date(opp.createdAt).toLocaleDateString("en-IN")}
                  </p>
                </div>
              </div>

              <Link
                href={`/dashboard/opportunities/${opp.id}`}
                className="inline-block px-4 py-2 bg-brand text-white rounded-md hover:bg-brand-deep transition-colors"
              >
                View Details →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
