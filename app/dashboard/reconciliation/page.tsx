"use client";

import { useEffect, useState } from "react";

interface ReconciliationCase {
  id: string;
  paymentIntentId: string | null;
  outcome: string;
  severity: string;
  status: string;
  internalAmount: number | null;
  externalAmount: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export default function ReconciliationPage() {
  const [cases, setCases] = useState<ReconciliationCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const fetchCases = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/reconciliation?limit=50");
      const data = await res.json();
      if (data.success) {
        setCases(data.data.cases);
      } else {
        setError(data.error?.message || "Failed to fetch");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const handleRunReconciliation = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/reconciliation/run", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        alert(`Reconciliation completed: ${data.data.casesCreatedOrUpdated} cases updated`);
        await fetchCases();
      } else {
        setError(data.error?.message || "Failed to run reconciliation");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return "bg-red-100 text-red-900";
      case "WARNING":
        return "bg-amber-100 text-amber-900";
      default:
        return "bg-emerald-100 text-emerald-900";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "RESOLVED":
        return "bg-emerald-100 text-emerald-900";
      case "OPEN":
        return "bg-red-100 text-red-900";
      default:
        return "bg-slate-100 text-slate-900";
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading reconciliation cases...</div>;
  }

  return (
    <div className="max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Reconciliation</h1>
        <button
          onClick={handleRunReconciliation}
          disabled={running}
          className="px-6 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? "Running..." : "Run Reconciliation"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
          {error}
        </div>
      )}

      {cases.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-12 text-center">
          <p className="text-slate-600">No reconciliation cases found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {cases.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{c.outcome}</h2>
                  <p className="text-sm text-slate-700 font-medium">ID: {c.id}</p>
                </div>
                <div className="flex gap-2">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${getSeverityColor(c.severity)}`}
                  >
                    {c.severity}
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(c.status)}`}
                  >
                    {c.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-slate-700 font-medium">Internal Amount</p>
                  <p className="text-lg font-semibold">
                    {c.internalAmount ? `₹${c.internalAmount / 100}` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-700 font-medium">External Amount</p>
                  <p className="text-lg font-semibold">
                    {c.externalAmount ? `₹${c.externalAmount / 100}` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-700 font-medium">Resolved</p>
                  <p className="text-sm">
                    {c.resolvedAt
                      ? new Date(c.resolvedAt).toLocaleDateString("en-IN")
                      : "Open"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
