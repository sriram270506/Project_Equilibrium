"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Button,
  Money,
  Callout,
  DataRow,
  MonoId,
  Table,
  Th,
  Td,
  LoadingState,
  ErrorState,
} from "@/src/components/ui/primitives";
import {
  StatusChip,
  SeverityBadge,
  LifecycleRail,
  Timeline,
  statusMeaning,
} from "@/src/components/ui/status";
import { cn } from "@/src/lib/utils";

interface PaymentDetail {
  payment: {
    id: string;
    internalReference: string;
    status: string;
    amountPaise: number;
    operationType: string;
    provider: string;
    providerPaymentId: string | null;
    providerIdempotencyKey: string;
    requestFingerprint: string;
    correlationId: string;
    failureMode: string | null;
    makerId: string | null;
    checkerId: string | null;
    approvalThresholdPaise: number | null;
    approvedAt: string | null;
    createdAt: string;
    confirmedAt: string | null;
    nextStates: string[];
  };
  supplier: { id: string; name: string; riskTier: string };
  ledger: {
    entries: Array<{
      id: string;
      accountCode: string;
      debitPaise: number;
      creditPaise: number;
      description: string;
    }>;
    totalDebits: number;
    totalCredits: number;
    balanced: boolean;
  };
  providerView: {
    status: string;
    amountPaise: number;
    failureMode: string | null;
  } | null;
  agreement: { amountMatches: boolean; statusMatches: boolean } | null;
  reconciliationCases: Array<{
    id: string;
    outcome: string;
    severity: string;
    status: string;
    internalAmountPaise: number;
    externalAmountPaise: number | null;
    createdAt: string;
  }>;
  outbox: Array<{
    id: string;
    eventType: string;
    status: string;
    attemptCount: number;
    publishedAt: string | null;
    lastError: string | null;
  }>;
  eventLog: Array<{
    sequenceNumber: number;
    eventType: string;
    idempotencyKey: string;
    createdAt: string;
  }>;
  timeline: Array<{
    sequence: number;
    eventType: string;
    actorType: string;
    actorId: string;
    payload: Record<string, unknown>;
    createdAt: string;
    entryHash: string;
  }>;
}

const LIFECYCLE = ["INTENT_CREATED", "SUBMITTED", "CONFIRMED"];

const ACTOR_TONE: Record<string, "ok" | "warn" | "info" | "brand" | "neutral"> =
  {
    OPERATOR: "brand",
    PROVIDER: "info",
    SYSTEM: "neutral",
    MODEL: "warn",
  };

export default function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.error?.message ?? "Failed to load this payment");
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function grantSecondApproval() {
    setActing(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/payments/${id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The seeded approver. In a real deployment this comes from a session.
          "X-API-Key": "key_approver_demo_12345",
        },
      });
      const json = await res.json();
      setActionMessage(
        json.success
          ? `Second approval granted by ${json.data.checkedBy}. Payment is now ${json.data.status}.`
          : (json.error?.message ?? "Approval failed")
      );
      await load();
    } catch {
      setActionMessage("Could not reach the API.");
    } finally {
      setActing(false);
    }
  }

  if (loading) return <LoadingState label="Tracing this payment" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { payment, supplier, ledger, providerView, agreement } = data;
  const awaitingSecondApproval = payment.status === "PENDING_APPROVAL";

  return (
    <div className="fade-up max-w-5xl">
      <Link
        href="/dashboard/payments"
        className="focusable mb-3 inline-flex text-[13px] font-medium text-brand-strong hover:underline"
      >
        ← All money movement
      </Link>

      <PageHeader
        title={supplier.name}
        lede={statusMeaning(payment.status)}
        action={
          <div className="text-right">
            <p className="tabular text-2xl font-semibold text-ink-strong">
              <Money paise={payment.amountPaise} />
            </p>
            <div className="mt-1.5 flex justify-end">
              <StatusChip status={payment.status} />
            </div>
          </div>
        }
      />

      {actionMessage ? (
        <div className="mb-4">
          <Callout tone="info">{actionMessage}</Callout>
        </div>
      ) : null}

      {/* Maker-checker gate */}
      {awaitingSecondApproval ? (
        <div className="mb-4">
          <Callout tone="warn" title="Held for a second approver">
            <p>
              At <Money paise={payment.amountPaise} /> this is above the
              dual-approval threshold of{" "}
              <Money paise={payment.approvalThresholdPaise ?? 0} />. It was
              raised by <strong>{payment.makerId}</strong> and cannot be
              released by that same person. No money has moved.
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              onClick={grantSecondApproval}
              disabled={acting}
            >
              {acting ? "Approving…" : "Approve as second operator"}
            </Button>
          </Callout>
        </div>
      ) : null}

      {/* Where it sits in the state machine */}
      <Card className="mb-4">
        <CardBody className="space-y-3">
          <p className="eyebrow">Lifecycle</p>
          <LifecycleRail steps={LIFECYCLE} current={payment.status} />
          {payment.nextStates.length > 0 ? (
            <p className="text-[13px] text-ink-muted">
              From here the only permitted transitions are{" "}
              {payment.nextStates.map((s, i) => (
                <span key={s}>
                  {i > 0 ? ", " : ""}
                  <span className="mono text-ink-body">{s}</span>
                </span>
              ))}
              . Anything else is rejected by the state machine, not by
              convention.
            </p>
          ) : (
            <p className="text-[13px] text-ink-muted">
              This is a terminal state. No further transitions are permitted.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Us versus the provider */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What we believe" eyebrow="Internal record" />
          <CardBody>
            <DataRow label="Status">
              <StatusChip status={payment.status} size="sm" />
            </DataRow>
            <DataRow label="Amount">
              <Money paise={payment.amountPaise} />
            </DataRow>
            <DataRow label="Internal reference">
              <MonoId value={payment.internalReference} />
            </DataRow>
            <DataRow
              label="Idempotency key"
              hint="prevents a retry from paying twice"
            >
              <MonoId value={payment.providerIdempotencyKey} truncate={22} />
            </DataRow>
            <DataRow label="Request fingerprint" hint="SHA-256 of the payload">
              <MonoId value={payment.requestFingerprint} truncate={22} />
            </DataRow>
          </CardBody>
        </Card>

        <Card
          className={cn(
            agreement &&
              (!agreement.amountMatches || !agreement.statusMatches) &&
              "border-warn/40"
          )}
        >
          <CardHeader title="What the provider believes" eyebrow="External record" />
          <CardBody>
            {providerView ? (
              <>
                <DataRow label="Status">
                  <span
                    className={cn(
                      agreement && !agreement.statusMatches && "text-warn"
                    )}
                  >
                    <StatusChip status={providerView.status} size="sm" />
                  </span>
                </DataRow>
                <DataRow label="Amount">
                  <span
                    className={cn(
                      agreement && !agreement.amountMatches && "text-danger"
                    )}
                  >
                    <Money paise={providerView.amountPaise} />
                  </span>
                </DataRow>
                <DataRow label="Provider payment id">
                  <MonoId value={payment.providerPaymentId ?? "—"} truncate={22} />
                </DataRow>
                <DataRow label="Injected failure">
                  {providerView.failureMode &&
                  providerView.failureMode !== "success" ? (
                    <span className="mono text-warn">
                      {providerView.failureMode}
                    </span>
                  ) : (
                    <span className="text-ink-muted">none</span>
                  )}
                </DataRow>
                {agreement && !agreement.statusMatches ? (
                  <p className="mt-3 text-[13px] leading-relaxed text-warn">
                    We and the provider disagree about the outcome. This is what
                    reconciliation exists to resolve — it is not an error, it is
                    the normal consequence of a network that can fail mid-call.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                Not yet submitted to the provider.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Ledger */}
      <Card className="mb-4">
        <CardHeader
          title="Ledger entries"
          hint="Written inside the same transaction as the payment itself."
          action={
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                ledger.balanced
                  ? "bg-ok-wash text-ok"
                  : "bg-danger-wash text-danger"
              )}
            >
              {ledger.balanced ? "Balanced" : "Out of balance"}
            </span>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th align="right">Debit</Th>
              <Th align="right">Credit</Th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((e) => (
              <tr key={e.id}>
                <Td className="mono text-ink-strong">{e.accountCode}</Td>
                <Td align="right">
                  {e.debitPaise > 0 ? <Money paise={e.debitPaise} /> : "—"}
                </Td>
                <Td align="right">
                  {e.creditPaise > 0 ? <Money paise={e.creditPaise} /> : "—"}
                </Td>
              </tr>
            ))}
            <tr className="bg-surface-sunken font-semibold">
              <Td className="font-semibold text-ink-strong">Total</Td>
              <Td align="right" className="font-semibold text-ink-strong">
                <Money paise={ledger.totalDebits} />
              </Td>
              <Td align="right" className="font-semibold text-ink-strong">
                <Money paise={ledger.totalCredits} />
              </Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      {/* Timeline */}
      <Card className="mb-4">
        <CardHeader
          title="What happened, in order"
          hint={`Every entry is chained by hash and linked by correlation id ${payment.correlationId}.`}
        />
        <CardBody>
          <Timeline
            items={data.timeline.map((e) => ({
              title: humaniseEvent(e.eventType),
              timestamp: e.createdAt,
              actor: `${e.actorId} (${e.actorType.toLowerCase()})`,
              tone: ACTOR_TONE[e.actorType] ?? "neutral",
              detail: (
                <div className="space-y-1">
                  <pre className="mono overflow-x-auto rounded bg-surface-sunken px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-body">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                  <p className="text-2xs text-ink-muted">
                    entry #{e.sequence} · hash{" "}
                    <span className="mono">{e.entryHash.slice(0, 16)}…</span>
                  </p>
                </div>
              ),
            }))}
          />
        </CardBody>
      </Card>

      {/* Reconciliation + outbox */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Reconciliation cases" />
          <CardBody>
            {data.reconciliationCases.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No cases raised. Run reconciliation from Exceptions to compare
                this payment against the provider.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.reconciliationCases.map((c) => (
                  <li key={c.id} className="flex items-start gap-3">
                    <SeverityBadge severity={c.severity} />
                    <div className="min-w-0">
                      <StatusChip status={c.outcome} size="sm" />
                      <p className="mt-1 text-2xs text-ink-muted">
                        {new Date(c.createdAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Event publishing"
            hint="Outbox rows are written in the payment transaction, then drained."
          />
          <CardBody>
            {data.outbox.length === 0 ? (
              <p className="text-sm text-ink-muted">No outbox events.</p>
            ) : (
              <ul className="space-y-2">
                {data.outbox.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <span className="mono text-ink-body">{e.eventType}</span>
                    <span className="flex items-center gap-2">
                      {e.attemptCount > 0 ? (
                        <span className="text-2xs text-ink-muted">
                          {e.attemptCount} attempt
                          {e.attemptCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      <StatusChip status={e.status} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.eventLog.length > 0 ? (
              <p className="mt-3 border-t border-line-soft pt-3 text-2xs text-ink-muted">
                {data.eventLog.length} entr
                {data.eventLog.length === 1 ? "y" : "ies"} in the append-only
                event log, each with a unique idempotency key so a replay cannot
                duplicate them.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function humaniseEvent(eventType: string): string {
  const map: Record<string, string> = {
    OPPORTUNITY_EVALUATED: "Model scored the supplier",
    OPPORTUNITY_APPROVED: "Operator approved the offer",
    SECOND_APPROVAL_GRANTED: "Second operator confirmed",
    PAYMENT_SUBMITTED: "Instruction sent to provider",
    PAYMENT_CONFIRMED: "Provider confirmed the payment",
    PAYMENT_UNKNOWN: "Provider call timed out — outcome unknown",
    PAYMENT_FAILED: "Provider declined the payment",
    WEBHOOK_RECEIVED: "Webhook received from provider",
    KILL_SWITCH_ENGAGED: "Kill switch engaged",
    KILL_SWITCH_RELEASED: "Kill switch released",
    RISK_LIMITS_UPDATED: "Risk limits changed",
  };
  return map[eventType] ?? eventType.split("_").join(" ").toLowerCase();
}
