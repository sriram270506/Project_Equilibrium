"use client";

import { useEffect, useState } from "react";
import { formatPaise } from "@/src/lib/money";

export default function DashboardPage() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        setHealth(data);
      } catch (err) {
        setError("Failed to fetch system health");
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
  }, []);

  if (loading) {
    return <div className="text-center py-8">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">{error}</div>;
  }

  return (
    <div className="max-w-7xl">
      <h1 className="text-3xl font-bold mb-8">Overview</h1>

      {/* System Status */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">System Status</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-slate-600">Status</p>
            <p className="text-lg font-semibold text-emerald-600">
              {health?.data?.status || "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Provider Mode</p>
            <p className="text-lg font-semibold text-blue-600">
              {health?.data?.provider || "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Application Mode</p>
            <p className="text-lg font-semibold text-purple-600">
              {health?.data?.mode || "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Timestamp</p>
            <p className="text-sm text-slate-600">
              {new Date(health?.data?.timestamp).toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-600 mb-2">Recommended Opportunities</p>
          <p className="text-3xl font-bold text-slate-900">2</p>
          <p className="text-xs text-slate-500 mt-2">Ready for review</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-600 mb-2">Expected Value</p>
          <p className="text-3xl font-bold text-emerald-600">
            {formatPaise(167000)}
          </p>
          <p className="text-xs text-slate-500 mt-2">Aggregated</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-600 mb-2">Active Payment Intents</p>
          <p className="text-3xl font-bold text-blue-600">1</p>
          <p className="text-xs text-slate-500 mt-2">Confirmed</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-600 mb-2">Open Reconciliation</p>
          <p className="text-3xl font-bold text-amber-600">1</p>
          <p className="text-xs text-slate-500 mt-2">Resolved</p>
        </div>
      </div>

      {/* Dashboard Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-2">Getting Started</h3>
        <p className="text-sm text-blue-800 mb-4">
          Equilibrium is a marketplace finance operations control layer. Use the navigation
          to explore liquidity opportunities, payment operations, and dispute evidence workflows.
        </p>
        <ul className="text-sm text-blue-800 space-y-2">
          <li>• <strong>Liquidity Opportunities:</strong> Review ML-assisted early-payment opportunities</li>
          <li>• <strong>Payment Operations:</strong> Monitor payment intents and reconciliation status</li>
          <li>• <strong>Dispute Evidence:</strong> Generate and validate dispute drafts from evidence</li>
          <li>• <strong>Demo Controls:</strong> Run failure scenarios and test resilience</li>
        </ul>
      </div>
    </div>
  );
}
