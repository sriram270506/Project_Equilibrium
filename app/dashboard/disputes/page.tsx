"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DisputeCase {
  id: string;
  providerDisputeId: string;
  reasonCode: string;
  amountPaise: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<DisputeCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDisputes = async () => {
      try {
        // For now, we'll load demo dispute data
        // In a real app, we'd have a /api/disputes endpoint
        
        // Load demo dispute from seeded data
        setDisputes([
          {
            id: "demo-dispute-1",
            providerDisputeId: "disp_demo_001",
            reasonCode: "PRODUCT_NOT_RECEIVED",
            amountPaise: 50000,
            status: "OPEN",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchDisputes();
  }, []);

  if (loading) {
    return <div className="text-center py-8">Loading disputes...</div>;
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-3xl font-bold mb-8">Dispute Evidence</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
          {error}
        </div>
      )}

      {disputes.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-12 text-center">
          <p className="text-slate-600">No disputes found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <Link
              key={dispute.id}
              href={`/dashboard/disputes/${dispute.id}`}
              className="block bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {dispute.reasonCode}
                  </h2>
                  <p className="text-sm text-slate-600">
                    ID: {dispute.providerDisputeId}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    dispute.status === "OPEN"
                      ? "bg-red-100 text-red-900"
                      : "bg-emerald-100 text-emerald-900"
                  }`}
                >
                  {dispute.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Amount</p>
                  <p className="text-lg font-semibold">
                    ₹{dispute.amountPaise / 100}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Created</p>
                  <p className="text-sm">
                    {new Date(dispute.createdAt).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-blue-600 font-semibold">
                    View Evidence →
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
