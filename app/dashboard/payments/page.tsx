"use client";

import { useEffect, useState } from "react";
import { formatPaise } from "@/src/lib/money";
import Link from "next/link";
import { PageHeader } from "@/src/components/ui/primitives";

interface Payment {
  id: string;
  internalReference: string;
  supplierId: string;
  supplierName: string;
  amountPaise: number;
  amountDisplay: string;
  status: string;
  provider: string;
  providerPaymentId: string | null;
  correlationId: string;
  createdAt: string;
  confirmedAt: string | null;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPayments = async () => {
      try {
        const res = await fetch("/api/payments?limit=50");
        const data = await res.json();
        if (data.success) {
          setPayments(data.data.payments);
        } else {
          setError(data.error?.message || "Failed to fetch");
        }
      } catch (err) {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchPayments();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return "bg-ok/[0.14] text-ok";
      case "UNKNOWN":
        return "bg-warn/[0.14] text-warn";
      case "FAILED":
        return "bg-red-100 text-danger";
      case "SUBMITTED":
        return "bg-blue-100 text-brand";
      default:
        return "bg-paper-tint text-ink-strong";
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading payments...</div>;
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Money movement"
        lede="Every payment end to end: what we instructed, what the provider says happened, the ledger entries behind it, and the hash-chained timeline."
      />

      {error && (
        <div className="bg-danger/[0.10] border border-danger/30 rounded-lg p-4 mb-6 text-danger">
          {error}
        </div>
      )}

      {payments.length === 0 ? (
        <div className="bg-paper-sunken border border-rule rounded-lg p-12 text-center">
          <p className="text-ink-muted">No payments found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className="glass  rounded-card p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {payment.supplierName}
                  </h2>
                  <p className="text-sm text-ink-muted">
                    Ref: {payment.internalReference}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-ok">
                    {formatPaise(payment.amountPaise)}
                  </p>
                  <span className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(payment.status)}`}>
                    {payment.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
                <div>
                  <p className="text-ink-body font-medium">Provider</p>
                  <p className="font-semibold">{payment.provider}</p>
                </div>
                <div>
                  <p className="text-ink-body font-medium">Provider ID</p>
                  <p className="font-mono text-xs">
                    {payment.providerPaymentId
                      ? payment.providerPaymentId.slice(0, 20) + "..."
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-ink-body font-medium">Correlation ID</p>
                  <p className="font-mono text-xs">
                    {payment.correlationId.slice(0, 20)}...
                  </p>
                </div>
                <div>
                  <p className="text-ink-body font-medium">Created</p>
                  <p>
                    {new Date(payment.createdAt).toLocaleDateString("en-IN")}
                  </p>
                </div>
              </div>

              <Link
                href={`/dashboard/payments/${payment.id}`}
                className="inline-block px-4 py-2 bg-brand text-white rounded-md hover:bg-brand-deep transition-colors"
              >
                View Timeline →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
