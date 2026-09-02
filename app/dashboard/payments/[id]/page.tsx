"use client";
"use client";

import { useEffect, useState, use } from "react";
import { formatPaise } from "@/src/lib/money";
import { useRouter } from "next/navigation";

interface PaymentDetail {
  id: string;
  internalReference: string;
  supplier: { name: string; email: string };
  amount: number;
  amountDisplay: string;
  status: string;
  provider: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  ledger: any[];
  timeline: any[];
}

export default function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPayment = async () => {
      try {
        const res = await fetch(`/api/payments/${resolvedParams.id}`);
        const data = await res.json();
        if (data.success) {
          setPayment(data.data);
        } else {
          setError(data.error?.message || "Failed to fetch");
        }
      } catch (err) {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchPayment();
  }, [resolvedParams.id]);

  if (loading) {
    return <div className="text-center py-8">Loading payment...</div>;
  }

  if (!payment) {
    return (
      <div className="text-center py-8 text-red-600">Payment not found</div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return "text-emerald-600 bg-emerald-50";
      case "UNKNOWN":
        return "text-amber-600 bg-amber-50";
      case "FAILED":
        return "text-red-600 bg-red-50";
      default:
        return "text-slate-600 bg-slate-50";
    }
  };

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => router.back()}
        className="mb-6 text-blue-600 hover:text-blue-700"
      >
        ← Back
      </button>

      <div className="bg-white rounded-lg shadow p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{payment.supplier.name}</h1>
          <p className="text-slate-600">{payment.supplier.email}</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
            {error}
          </div>
        )}

        <div className={`rounded-lg p-6 mb-8 ${getStatusColor(payment.status)}`}>
          <p className="text-sm font-semibold mb-2">Payment Status</p>
          <p className="text-2xl font-bold">{payment.status}</p>
          {payment.status === "UNKNOWN" && (
            <p className="text-sm mt-2">
              Provider status cannot be determined. Run reconciliation to resolve.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8">
          <section>
            <h2 className="text-lg font-semibold mb-4">Amount</h2>
            <p className="text-3xl font-bold text-emerald-600">
              {formatPaise(payment.amount)}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">Provider Details</h2>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-slate-600">Provider:</span>
                <span className="font-semibold ml-2">{payment.provider}</span>
              </p>
              {payment.providerPaymentId && (
                <p>
                  <span className="text-slate-600">Payment ID:</span>
                  <span className="font-mono text-xs ml-2">
                    {payment.providerPaymentId}
                  </span>
                </p>
              )}
              {payment.providerOrderId && (
                <p>
                  <span className="text-slate-600">Order ID:</span>
                  <span className="font-mono text-xs ml-2">
                    {payment.providerOrderId}
                  </span>
                </p>
              )}
              <p>
                <span className="text-slate-600">Correlation ID:</span>
                <span className="font-mono text-xs ml-2">
                  {payment.correlationId}
                </span>
              </p>
            </div>
          </section>
        </div>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Timeline</h2>
          <div className="space-y-4">
            {payment.timeline && payment.timeline.length > 0 ? (
              payment.timeline.map((event, idx) => (
                <div
                  key={idx}
                  className="border-l-4 border-blue-500 pl-4 py-2"
                >
                  <p className="text-sm font-semibold">{event.eventType}</p>
                  <p className="text-xs text-slate-600">
                    {new Date(event.timestamp).toLocaleString("en-IN")}
                  </p>
                  <p className="text-xs text-slate-700 mt-1">
                    Actor: {event.actor}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-slate-600">No events recorded</p>
            )}
          </div>
        </section>

        <section className="bg-slate-50 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Ledger</h2>
          {payment.ledger && payment.ledger.length > 0 ? (
            <div className="space-y-4">
              {payment.ledger.map((tx, idx) => (
                <div key={idx} className="border-t pt-4">
                  <p className="text-sm font-semibold text-slate-700">
                    {tx.description}
                  </p>
                  <table className="w-full mt-2 text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left text-slate-600 font-medium">Account Code</th>
                        <th className="text-right text-slate-600 font-medium">Debit</th>
                        <th className="text-right text-slate-600 font-medium">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tx.entries.map((entry: any) => (
                        <tr key={entry.id} className="border-t">
                          <td className="text-left py-2">{entry.accountCode}</td>
                          <td className="text-right py-2">
                            {entry.debitPaise > 0 ? `₹${entry.debitPaise / 100}` : "-"}
                          </td>
                          <td className="text-right py-2">
                            {entry.creditPaise > 0 ? `₹${entry.creditPaise / 100}` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-600">No ledger entries</p>
          )}
        </section>
      </div>
    </div>
  );
}
