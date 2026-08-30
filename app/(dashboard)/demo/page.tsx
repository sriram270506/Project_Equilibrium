"use client";

import { useState } from "react";

export default function DemoPage() {
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    const confirmed = window.confirm(
      "This will reset all demo data. Continue?"
    );
    if (!confirmed) return;

    setResetting(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage(
          `Demo reset complete. Created ${data.data.suppliersCreated} suppliers.`
        );
      } else {
        setError(data.error?.message || "Failed to reset demo");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Demo Controls</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
        <h2 className="font-semibold text-blue-900 mb-2">About Demo Mode</h2>
        <p className="text-sm text-blue-800">
          Equilibrium runs in demo mode with synthetic data and MockRazorpay provider.
          Use the controls below to reset the demo state or run failure scenarios.
        </p>
      </div>

      {message && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 text-emerald-800">
          ✓ {message}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
          ✗ {error}
        </div>
      )}

      <div className="space-y-6">
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Database Management</h2>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="w-full px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {resetting ? "Resetting..." : "Reset All Demo Data"}
          </button>
          <p className="text-sm text-slate-600 mt-3">
            Clears all data and re-seeds with fresh demo scenarios.
          </p>
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Hero Demo Workflow</h2>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              1. Navigate to <strong>Liquidity Opportunities</strong>
            </p>
            <p className="text-sm text-slate-700">
              2. Find "Aarav Industrial Components" with status RECOMMENDED
            </p>
            <p className="text-sm text-slate-700">
              3. Click "View Details" and review the ML model prediction
            </p>
            <p className="text-sm text-slate-700">
              4. Click "Approve Opportunity" to create a payment intent
            </p>
            <p className="text-sm text-slate-700">
              5. Go to <strong>Payment Operations</strong> to see the payment status
            </p>
            <p className="text-sm text-slate-700">
              6. Go to <strong>Reconciliation</strong> and run reconciliation
            </p>
            <p className="text-sm text-slate-700">
              7. Observe the matched payment and balanced ledger
            </p>
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Failure Scenarios</h2>
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              <strong>Timeout After Remote Success:</strong> Provider confirms payment,
              but client times out. Payment appears as UNKNOWN internally.
            </p>
            <p>
              <strong>Duplicate Webhook:</strong> Same webhook sent twice. System
              handles idempotently without creating duplicate ledger entries.
            </p>
            <p>
              <strong>Amount Mismatch:</strong> Provider and internal records differ.
              Reconciliation detects and creates a case for manual review.
            </p>
          </div>
        </section>

        <section className="bg-slate-50 border border-slate-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">System Information</h2>
          <div className="space-y-2 text-sm font-mono">
            <p>Mode: <span className="font-semibold">DEMO</span></p>
            <p>Provider: <span className="font-semibold">MockRazorpay</span></p>
            <p>Database: <span className="font-semibold">SQLite (dev.db)</span></p>
            <p>Auth: <span className="font-semibold">demo-finance-operator</span></p>
          </div>
        </section>
      </div>
    </div>
  );
}
