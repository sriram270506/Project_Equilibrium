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
import { cn } from "@/src/lib/utils";

interface StepResult {
  step: string;
  title: string;
  narration: string;
  whyItMatters: string;
  facts: Array<{ label: string; value: string; tone?: "ok" | "warn" | "danger" }>;
  verifyAt?: { href: string; label: string };
  context?: Record<string, string>;
}

const STEPS: Array<{
  id: string;
  title: string;
  summary: string;
  act: string;
}> = [
  {
    id: "reset",
    title: "Start from a clean slate",
    summary: "Twelve suppliers with 30 days of cash-flow history.",
    act: "Setup",
  },
  {
    id: "score",
    title: "Find who is about to run short",
    summary: "Score every supplier; policy bounds every offer.",
    act: "Decide",
  },
  {
    id: "approve",
    title: "Approve the offer and move money",
    summary: "One transaction: intent, ledger, audit, outbox.",
    act: "Decide",
  },
  {
    id: "timeout",
    title: "Break it: the provider times out",
    summary: "The call dies after the money may have left.",
    act: "Survive failure",
  },
  {
    id: "duplicate_webhook",
    title: "Break it again: the webhook arrives twice",
    summary: "A replayed delivery must change nothing.",
    act: "Survive failure",
  },
  {
    id: "reconcile",
    title: "Resolve the unknown",
    summary: "Settle the truth against the provider.",
    act: "Survive failure",
  },
  {
    id: "prove",
    title: "Prove nothing was lost",
    summary: "The books foot after two injected failures.",
    act: "Prove",
  },
];

export default function GuidedDemoPage() {
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<{ step: string; message: string } | null>(
    null
  );
  const [context, setContext] = useState<Record<string, string>>({});
  const [autoRunning, setAutoRunning] = useState(false);

  const currentIndex = STEPS.findIndex((s) => !results[s.id]);
  const nextStep = currentIndex >= 0 ? STEPS[currentIndex] : null;
  const allDone = currentIndex === -1;

  async function runStep(stepId: string, carried = context) {
    setRunning(stepId);
    setError(null);
    try {
      const res = await fetch("/api/demo/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepId, context: carried }),
      });
      const json = await res.json();

      if (!json.success) {
        setError({
          step: stepId,
          message: json.error?.message ?? "Step failed",
        });
        return null;
      }

      const result: StepResult = json.data;
      setResults((prev) => ({ ...prev, [stepId]: result }));
      const merged = { ...carried, ...(result.context ?? {}) };
      setContext(merged);
      return merged;
    } catch {
      setError({ step: stepId, message: "Could not reach the API." });
      return null;
    } finally {
      setRunning(null);
    }
  }

  async function runAll() {
    setAutoRunning(true);
    setResults({});
    setError(null);
    let carried: Record<string, string> = {};
    for (const step of STEPS) {
      const merged = await runStep(step.id, carried);
      if (!merged) break;
      carried = merged;
      // A beat between steps so a viewer can read each one.
      await new Promise((r) => setTimeout(r, 700));
    }
    setAutoRunning(false);
  }

  function reset() {
    setResults({});
    setContext({});
    setError(null);
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Guided walkthrough"
        lede="Seven steps against the real services — no mocked responses, no staged data. Two of them deliberately break the payment provider to show what the system does when things go wrong."
        action={
          <div className="flex gap-2">
            {Object.keys(results).length > 0 ? (
              <Button variant="ghost" size="sm" onClick={reset} disabled={autoRunning}>
                Clear
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={runAll}
              disabled={autoRunning || running !== null}
            >
              {autoRunning ? "Running…" : "Run all seven steps"}
            </Button>
          </div>
        }
      />

      <Callout tone="brand" title="What you are about to watch">
        A supplier is projected to run out of cash. The model explains why, policy
        prices the offer, an operator approves it, and money moves. Then the
        provider times out mid-payment and later sends a duplicate webhook.
        Nothing is double-paid, nothing is lost, and the books still foot at the
        end.
      </Callout>

      <ol className="mt-6 space-y-3">
        {STEPS.map((step, i) => {
          const result = results[step.id];
          const isRunning = running === step.id;
          const isNext = nextStep?.id === step.id;
          const failed = error?.step === step.id;
          const showActHeading =
            i === 0 || STEPS[i - 1].act !== step.act;

          return (
            <li key={step.id}>
              {showActHeading ? (
                <p className="eyebrow mb-2 mt-5 first:mt-0">{step.act}</p>
              ) : null}

              <Card
                className={cn(
                  "transition-colors",
                  isNext && !result && "ring-1 ring-brand/40",
                  failed && "border-danger/40"
                )}
              >
                <CardBody className="space-y-0">
                  <div className="flex items-start gap-4">
                    {/* Step marker */}
                    <span
                      className={cn(
                        "tabular mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                        result && "bg-ok text-white",
                        !result && isRunning && "bg-brand text-white pulse-ring",
                        !result && !isRunning && isNext && "bg-brand/[0.12] text-brand",
                        !result && !isRunning && !isNext && "bg-surface-sunken text-ink-muted"
                      )}
                    >
                      {result ? "✓" : i + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-[15px] font-semibold text-ink-strong">
                            {step.title}
                          </h3>
                          <p className="mt-0.5 text-[13px] text-ink-muted">
                            {step.summary}
                          </p>
                        </div>

                        {!result ? (
                          <Button
                            size="sm"
                            variant={isNext ? "primary" : "secondary"}
                            onClick={() => runStep(step.id)}
                            disabled={running !== null || autoRunning}
                          >
                            {isRunning ? "Running…" : "Run step"}
                          </Button>
                        ) : null}
                      </div>

                      {/* Result */}
                      {result ? (
                        <div className="fade-up mt-4 space-y-4">
                          <p className="text-[15px] leading-relaxed text-ink-body">
                            {result.narration}
                          </p>

                          <div className="grid gap-x-6 gap-y-2 rounded-md border border-line-soft bg-surface-sunken px-4 py-3 sm:grid-cols-2">
                            {result.facts.map((fact) => (
                              <div
                                key={fact.label}
                                className="flex items-baseline justify-between gap-3 text-[13px]"
                              >
                                <span className="text-ink-muted">
                                  {fact.label}
                                </span>
                                <span
                                  className={cn(
                                    "tabular text-right font-medium",
                                    fact.tone === "ok" && "text-ok",
                                    fact.tone === "warn" && "text-warn",
                                    fact.tone === "danger" && "text-danger",
                                    !fact.tone && "text-ink-strong"
                                  )}
                                >
                                  {fact.value.startsWith("corr_") ||
                                  fact.value.startsWith("pay_") ? (
                                    <MonoId value={fact.value} truncate={18} />
                                  ) : (
                                    fact.value
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>

                          <div className="rounded-md border-l-2 border-brand bg-brand/[0.12] px-4 py-3">
                            <p className="text-2xs font-semibold uppercase tracking-wider text-brand">
                              Why this is hard
                            </p>
                            <p className="mt-1 text-[14px] leading-relaxed text-ink-body">
                              {result.whyItMatters}
                            </p>
                          </div>

                          {result.verifyAt ? (
                            <Link
                              href={result.verifyAt.href}
                              className="focusable inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
                            >
                              {result.verifyAt.label} →
                            </Link>
                          ) : null}
                        </div>
                      ) : null}

                      {failed ? (
                        <div className="mt-3 rounded-md border border-danger/30 bg-danger/[0.12] px-4 py-3 text-[13px] text-ink-body">
                          <p className="font-semibold text-danger">
                            This step could not run
                          </p>
                          <p className="mt-1">{error.message}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ol>

      {allDone ? (
        <div className="fade-up mt-6">
          <Card className="border-ok/30 bg-ok/[0.12]">
            <CardHeader
              title="That is the whole system"
              hint="Two suppliers were paid early, the provider failed twice, and the ledger still balances to the paisa."
            />
            <CardBody className="flex flex-wrap gap-3">
              <Link
                href="/dashboard/ledger"
                className="focusable rounded-md bg-brand-deep px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand"
              >
                Verify the trial balance
              </Link>
              <Link
                href="/dashboard/reconciliation"
                className="focusable rounded-md border border-line-strong bg-surface-card px-4 py-2 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
              >
                Inspect exceptions
              </Link>
              <Link
                href="/dashboard/payments"
                className="focusable rounded-md border border-line-strong bg-surface-card px-4 py-2 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
              >
                Trace a payment
              </Link>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
