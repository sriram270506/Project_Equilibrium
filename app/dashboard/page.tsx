"use client";

import { useEffect, useState } from "react";
import { formatPaise } from "@/src/lib/money";

interface DashboardData {
  kpis: {
    recommendedOpportunities: number;
    expectedValuePaise: number;
    activePaymentIntents: number;
    openReconciliationCases: number;
  };
}

interface HealthData {
  status: string;
  mode: string;
  provider: string;
  timestamp: string;
}

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch health data
        const healthRes = await fetch("/api/health");
        if (!healthRes.ok) throw new Error("Health check failed");
        const healthData = await healthRes.json();
        
        // Fetch dashboard data
        const dashboardRes = await fetch("/api/dashboard");
        if (!dashboardRes.ok) throw new Error("Dashboard data failed");
        const dashboardData = await dashboardRes.json();
        
        if (healthData.success && dashboardData.success) {
          setHealth(healthData.data);
          setDashboard(dashboardData.data);
        } else {
          setError("Failed to load dashboard data");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return <div className="text-center py-8">Loading dashboard...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 inline-block">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <h1 className="text-3xl font-bold mb-8">Overview</h1>

      {/* System Status */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">System Status</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-slate-700 font-medium">Status</p>
            <p className="text-lg font-semibold text-emerald-600">
              {health?.status || "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-700 font-medium">Provider Mode</p>
            <p className="text-lg font-semibold text-blue-600">
              {health?.provider || "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-700 font-medium">Application Mode</p>
            <p className="text-lg font-semibold text-purple-600">
              {health?.mode || "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-700 font-medium">Timestamp</p>
            <p className="text-sm text-slate-800">
              {health?.timestamp ? new Date(health.timestamp).toLocaleString("en-IN") : "Unknown"}
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-700 font-medium mb-2">Recommended Opportunities</p>
          <p className="text-3xl font-bold text-slate-900">
            {dashboard?.kpis.recommendedOpportunities ?? 0}
          </p>
          <p className="text-xs text-slate-700 mt-2">Ready for review</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-700 font-medium mb-2">Expected Value</p>
          <p className="text-3xl font-bold text-emerald-600">
            {formatPaise(dashboard?.kpis.expectedValuePaise ?? 0)}
          </p>
          <p className="text-xs text-slate-700 mt-2">Aggregated</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-700 font-medium mb-2">Active Payment Intents</p>
          <p className="text-3xl font-bold text-blue-600">
            {dashboard?.kpis.activePaymentIntents ?? 0}
          </p>
          <p className="text-xs text-slate-700 mt-2">Confirmed</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-slate-700 font-medium mb-2">Open Reconciliation</p>
          <p className="text-3xl font-bold text-amber-600">
            {dashboard?.kpis.openReconciliationCases ?? 0}
          </p>
          <p className="text-xs text-slate-700 mt-2">Cases</p>
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
