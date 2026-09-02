"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Button,
  Money,
  Callout,
  Table,
  Th,
  Td,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/src/components/ui/primitives";
import { cn } from "@/src/lib/utils";

interface AccountBalance {
  accountCode: string;
  debitPaise: number;
  creditPaise: number;
  netPaise: number;
}

interface TrialBalanceData {
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  net: number;
  accounts: AccountBalance[];
  asOfDate: string;
}

/** What each account actually means, so the page teaches rather than dumps. */
const ACCOUNT_MEANINGS: Record<string, string> = {
  PLATFORM_CASH: "The platform's own money, used to fund early payments.",
  SUPPLIER_PAYABLE: "What the platform owes suppliers it has paid early.",
  DISCOUNT_EXPENSE: "The cost of the discount extended on each deal.",
  PROVIDER_CLEARING: "Funds in transit at the payment provider.",
  ESCROW_LIABILITY: "Funds held on behalf of another party.",
  REFUND_RESERVE: "Set aside against expected reversals.",
};

export default function TrialBalancePage() {
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ledger/trial-balance", {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) {
        setData(json.data.trialBalance ?? json.data);
      } else {
        setError(json.error?.message ?? "Failed to load the trial balance");
      }
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="Totalling the ledger" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="fade-up max-w-5xl">
      <PageHeader
        title="Trial balance"
        lede="Every rupee that moves writes two entries: one debit, one credit. If these two totals ever diverge, money has been created or destroyed somewhere in the system — so this page is the single strongest correctness claim the platform makes."
        action={
          <Button variant="secondary" size="sm" onClick={load}>
            Recalculate
          </Button>
        }
      />

      {/* The claim, checked live. */}
      <Card
        className={cn(
          "mb-6",
          data.balanced
            ? "border-ok/30 bg-ok-wash"
            : "border-danger/40 bg-danger-wash"
        )}
      >
        <CardBody>
          <div className="flex flex-wrap items-center gap-6">
            <span
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full text-2xl text-white",
                data.balanced ? "bg-ok" : "bg-danger"
              )}
            >
              {data.balanced ? "✓" : "!"}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-ink-strong">
                {data.balanced
                  ? "Debits equal credits exactly"
                  : "The ledger does not balance"}
              </p>
              <p className="mt-1 text-sm text-ink-body">
                {data.balanced
                  ? "No rupee has been created or lost, including across the deliberately failed payments in the walkthrough."
                  : "This is a correctness failure. No further payments should be released until it is explained."}
              </p>
            </div>

            <div className="flex gap-8">
              <div className="text-right">
                <p className="text-2xs text-ink-muted">Total debits</p>
                <p className="tabular text-xl font-semibold text-ink-strong">
                  <Money paise={data.totalDebits} />
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xs text-ink-muted">Total credits</p>
                <p className="tabular text-xl font-semibold text-ink-strong">
                  <Money paise={data.totalCredits} />
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xs text-ink-muted">Difference</p>
                <p
                  className={cn(
                    "tabular text-xl font-semibold",
                    data.net === 0 ? "text-ok" : "text-danger"
                  )}
                >
                  <Money paise={data.net} />
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Balances by account"
          hint="Debit balances are positive; credit balances are negative. The net column must sum to zero."
        />
        {data.accounts.length === 0 ? (
          <EmptyState title="No ledger entries yet">
            Approve an early-payment offer, or run the guided walkthrough, and
            balanced entries will appear here.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th align="right">Debits</Th>
                  <Th align="right">Credits</Th>
                  <Th align="right">Net</Th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((account) => (
                  <tr key={account.accountCode} className="hover:bg-surface-sunken">
                    <Td>
                      <p className="mono font-medium text-ink-strong">
                        {account.accountCode}
                      </p>
                      {ACCOUNT_MEANINGS[account.accountCode] ? (
                        <p className="mt-0.5 text-2xs text-ink-muted">
                          {ACCOUNT_MEANINGS[account.accountCode]}
                        </p>
                      ) : null}
                    </Td>
                    <Td align="right">
                      <Money paise={account.debitPaise} />
                    </Td>
                    <Td align="right">
                      <Money paise={account.creditPaise} />
                    </Td>
                    <Td
                      align="right"
                      className={cn(
                        "font-medium",
                        account.netPaise === 0
                          ? "text-ink-muted"
                          : account.netPaise > 0
                            ? "text-ink-strong"
                            : "text-brand-strong"
                      )}
                    >
                      <Money paise={account.netPaise} />
                    </Td>
                  </tr>
                ))}
                <tr className="bg-surface-sunken font-semibold">
                  <Td className="font-semibold text-ink-strong">Total</Td>
                  <Td align="right" className="font-semibold text-ink-strong">
                    <Money paise={data.totalDebits} />
                  </Td>
                  <Td align="right" className="font-semibold text-ink-strong">
                    <Money paise={data.totalCredits} />
                  </Td>
                  <Td
                    align="right"
                    className={cn(
                      "font-semibold",
                      data.net === 0 ? "text-ok" : "text-danger"
                    )}
                  >
                    <Money paise={data.net} />
                  </Td>
                </tr>
              </tbody>
            </Table>

            <CardBody>
              <Callout tone="info" title="Why double entry, in a prototype">
                Single-entry systems lose money silently: a status flag flips,
                nothing else changes, and the discrepancy only surfaces at
                month-end when nobody can reconstruct what happened. Double entry
                makes the error impossible to hide — the totals stop matching the
                moment a code path writes only one side.
              </Callout>
            </CardBody>
          </>
        )}
      </Card>
    </div>
  );
}
