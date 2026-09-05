"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Button,
  Callout,
  MonoId,
} from "@/src/components/ui/primitives";
import { StatusChip } from "@/src/components/ui/status";
import { cn } from "@/src/lib/utils";

interface InjectResult {
  failure: string;
  expectation: string;
  whyItMatters: string;
  supplierName: string;
  paymentIntentId: string;
  correlationId?: string;
  observed: Record<string, unknown>;
  survived: boolean;
  verdict: string;
}

const FAILURES: Array<{
  id: string;
  title: string;
  blurb: string;
  severity: "normal" | "nasty";
}> = [
  {
    id: "success",
    title: "Happy path",
    blurb: "Provider confirms immediately. The control case.",
    severity: "normal",
  },
  {
    id: "timeout_after_remote_success",
    title: "Timeout after the money left",
    blurb:
      "The provider committed the payment, then the connection died before we heard back.",
    severity: "nasty",
  },
  {
    id: "timeout_before_processing",
    title: "Timeout before processing",
    blurb:
      "The provider never got to it — but from our side this looks identical to the case above.",
    severity: "nasty",
  },
  {
    id: "provider_decline",
    title: "Provider declines",
    blurb: "A clean rejection. No money moves, but the books must still foot.",
    severity: "normal",
  },
  {
    id: "duplicate_webhook",
    title: "Webhook delivered twice",
    blurb:
      "The same provider event arrives again. Nothing may change the second time.",
    severity: "nasty",
  },
];

export default function FailureConsolePage() {
  const [results, setResults] = useState<Record<string, InjectResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null);

  async function inject(failure: string) {
    setRunning(failure);
    setErrors((prev) => ({ ...prev, [failure]: "" }));
    try {
      const res = await fetch("/api/demo/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ failure }),
      });
      const json = await res.json();
      if (json.success) {
        setResults((prev) => ({ ...prev, [failure]: json.data }));
      } else {
        setErrors((prev) => ({
          ...prev,
          [failure]: json.error?.message ?? "Injection failed",
        }));
      }
    } catch {
      setErrors((prev) => ({ ...prev, [failure]: "Could not reach the API." }));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="fade-up max-w-4xl">
      <PageHeader
        title="Failure injection"
        lede="Break the payment provider on purpose and watch what the system does. Every distributed payments system claims to survive these; this page lets you check rather than take it on trust."
      />

      <Callout tone="warn" title="Each run moves real demo money">
        Injecting a failure approves the highest-scoring outstanding offer and
        sends it to the mock provider. Run the{" "}
        <Link
          href="/dashboard/demo"
          className="font-medium text-brand hover:underline"
        >
          guided walkthrough
        </Link>{" "}
        first if there are no offers left to work with.
      </Callout>

      <div className="mt-6 space-y-3">
        {FAILURES.map((f) => {
          const result = results[f.id];
          const errorMessage = errors[f.id];
          const isRunning = running === f.id;

          return (
            <Card
              key={f.id}
              className={cn(
                result && (result.survived ? "border-ok/30" : "border-danger/40")
              )}
            >
              <CardHeader
                eyebrow={f.severity === "nasty" ? "Hard case" : "Baseline"}
                title={f.title}
                hint={f.blurb}
                action={
                  <Button
                    size="sm"
                    variant={f.severity === "nasty" ? "primary" : "secondary"}
                    onClick={() => inject(f.id)}
                    disabled={running !== null}
                  >
                    {isRunning ? "Injecting…" : "Inject"}
                  </Button>
                }
              />

              {result || errorMessage ? (
                <CardBody className="fade-up space-y-3">
                  {errorMessage ? (
                    <p className="text-[13px] text-danger">{errorMessage}</p>
                  ) : result ? (
                    <>
                      <div
                        className={cn(
                          "flex items-start gap-3 rounded-md border px-4 py-3",
                          result.survived
                            ? "border-ok/30 bg-ok/[0.12]"
                            : "border-danger/30 bg-danger/[0.12]"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-ink-strong",
                            result.survived ? "bg-ok" : "bg-danger"
                          )}
                        >
                          {result.survived ? "✓" : "!"}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-ink-strong">
                            {result.verdict}
                          </p>
                          <p className="mt-1 text-[13px] leading-relaxed text-ink-body">
                            {result.expectation}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-x-6 gap-y-1.5 rounded-md border border-line-soft bg-surface-sunken px-4 py-3 sm:grid-cols-2">
                        {Object.entries(result.observed).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-baseline justify-between gap-3 text-[13px]"
                          >
                            <span className="text-ink-muted">
                              {humanise(key)}
                            </span>
                            <span className="tabular text-right font-medium text-ink-strong">
                              {typeof value === "boolean" ? (
                                value ? (
                                  <span className="text-ok">yes</span>
                                ) : (
                                  <span className="text-danger">no</span>
                                )
                              ) : key.toLowerCase().includes("status") ? (
                                <StatusChip status={String(value)} size="sm" />
                              ) : (
                                String(value)
                              )}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-md border-l-2 border-brand bg-brand/[0.12] px-4 py-3">
                        <p className="text-2xs font-semibold uppercase tracking-wider text-brand">
                          Why this one is hard
                        </p>
                        <p className="mt-1 text-[14px] leading-relaxed text-ink-body">
                          {result.whyItMatters}
                        </p>
                      </div>

                      {result.paymentIntentId ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-2xs text-ink-muted">
                            {result.supplierName}
                            {result.correlationId ? (
                              <>
                                {" · "}
                                <MonoId
                                  value={result.correlationId}
                                  truncate={16}
                                />
                              </>
                            ) : null}
                          </span>
                          <Link
                            href={`/dashboard/payments/${result.paymentIntentId}`}
                            className="focusable text-[13px] font-medium text-brand hover:underline"
                          >
                            Inspect the payment →
                          </Link>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </CardBody>
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <Callout tone="info" title="After injecting a timeout">
          The payment sits in UNKNOWN, which is not a dead end — open{" "}
          <Link
            href="/dashboard/reconciliation"
            className="font-medium text-brand hover:underline"
          >
            Exceptions
          </Link>{" "}
          and run reconciliation to watch it resolve against the provider&apos;s
          own record.
        </Callout>
      </div>
    </div>
  );
}

function humanise(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
