"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, PageHeader } from "@/src/components/ui/primitives";

type ToolCall = { name: string; input: Record<string, unknown>; output: Record<string, unknown>; status: string };
type Result = { traceId: string; status: string; recommendation: string; stopReason: string | null; toolCalls: ToolCall[]; facts: Record<string, unknown> };

export default function ControllerPage() {
  const [invoiceId, setInvoiceId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runController() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/controller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error?.message ?? "Controller run failed");
      setResult(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Controller run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="AI Finance Controller" lede="The controller reads financial evidence and proposes the next safe operation. Policy, payment, ledger, and reconciliation controls remain authoritative." />
      <Card className="mb-6">
        <CardHeader title="Run a bounded review" hint="Provide an invoice ID. The controller cannot approve or submit money movement." />
        <CardBody>
          <div className="flex flex-wrap gap-3">
            <input aria-label="Invoice ID" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)} placeholder="inv_..." className="min-w-[18rem] flex-1 rounded border border-line-strong bg-surface-page px-3 py-2 text-sm" />
            <button type="button" disabled={!invoiceId || running} onClick={runController} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{running ? "Running..." : "Run controller"}</button>
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </CardBody>
      </Card>

      {result ? (
        <div className="space-y-6">
          <Card tone={result.status === "STOPPED" ? "sunken" : "default"}>
            <CardHeader title={result.recommendation} eyebrow={result.status} hint={result.stopReason ? `Stopped because: ${result.stopReason}` : "Human approval is still required before any payment action."} />
            <CardBody><p className="text-xs text-ink-muted">Trace {result.traceId}</p></CardBody>
          </Card>
          <Card>
            <CardHeader title="Controller trace" hint="Typed tool calls, inputs, outputs, and stop decisions." />
            <CardBody>
              <ol className="space-y-3">
                {result.toolCalls.map((call, index) => (
                  <li key={`${call.name}-${index}`} className="rounded border border-line-soft bg-surface-sunken p-3">
                    <div className="flex items-center justify-between gap-3"><strong className="text-sm text-ink-strong">{index + 1}. {call.name}</strong><span className="text-2xs font-semibold text-ink-muted">{call.status}</span></div>
                    <pre className="mt-2 overflow-x-auto text-xs text-ink-body">{JSON.stringify(call.output, null, 2)}</pre>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}