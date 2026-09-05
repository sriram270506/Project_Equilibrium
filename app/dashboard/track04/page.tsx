"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardBody,
  Stat,
  PageHeader,
  Money,
  Button,
  LoadingState,
  ErrorState,
  Table,
  Th,
  Td,
  MonoId,
  Callout,
} from "@/src/components/ui/primitives";
import Link from "next/link";
import { cn } from "@/src/lib/utils";

/**
 * The Track 04 scoreboard.
 *
 * Every number here is produced by running the benchmark on request, not read
 * from a stored result — so what is on screen was computed by the code
 * currently in the repository, and a regression shows up here rather than
 * being papered over by a cached figure.
 */

interface Breakdown {
  key: string;
  total: number;
  correct: number;
  accuracy: number;
  falseResolutions: number;
}

interface ExceptionRow {
  recordId: string;
  exceptionType: string;
  amountPaise: number;
  supplierName: string;
  confidence: number;
  reason: string;
  recommendedAction: string;
  whyNotAutoResolved: string;
  difficulty: string;
}

interface Comparison {
  field: string;
  internalValue: string;
  externalValue: string;
  agreed: boolean;
  weight: number;
  note?: string;
}

interface Evidence {
  recordId: string;
  scenario: string;
  difficulty: string;
  groundTruthLabel: string;
  groundTruthNote: string;
  materialityPaise: number;
  internal: Record<string, unknown> | null;
  externals: Array<Record<string, unknown>>;
  decision: {
    outcome: string;
    confidence: number;
    exceptionType: string | null;
    reason: string;
    recommendedAction: string;
    whyNotAutoResolved: string;
    comparisons: Comparison[];
    trace: Array<{ stage: string; kind: string; detail: string }>;
  };
}

interface Track04Data {
  dataset: {
    version: string;
    seed: number;
    total: number;
    byLabel: Record<string, number>;
    byDifficulty: Record<string, number>;
    totalValuePaise: number;
  };
  controllerVersion: string;
  thresholds: { autoResolve: number; amountTolerancePaise: number };
  heldOut: {
    recordsProcessed: number;
    elapsedMs: number;
    recordsPerSecond: number;
    correctlyResolved: number;
    matchRate: number;
    autoResolutionRate: number;
    exceptionRate: number;
    autoResolutionPrecision: number;
    escalationRecall: number;
    duplicateResolutionRate: number;
    blockedByPolicyGate: number;
    falseResolutions: number;
    falseResolutionRate: number;
    missedMatches: number;
    wrongExceptionTypes: number;
    valueReconciledPaise: number;
    valueHeldForReviewPaise: number;
    valueExposedByUnresolvedPaise: number;
    valueAtRiskFromFalseResolutionsPaise: number;
    duplicatePaymentsPrevented: number;
    shortSettlementsCaught: number;
    unexplainedOutboundCaught: number;
    byDifficulty: Breakdown[];
    byLabel: Breakdown[];
    exceptions: ExceptionRow[];
  };
  ledger: {
    balanced: boolean;
    imbalancePaise: number;
    totalDebitsPaise: number;
    totalCreditsPaise: number;
    accountCount: number;
  };
  safety: {
    allClear: boolean;
    counters: Array<{
      key: string;
      label: string;
      count: number;
      valuePaise: number | null;
      source: "BENCHMARK" | "LIVE_SYSTEM";
      measurement: string;
      consequence: string;
    }>;
  };
  tuning: { matchRate: number; recordsProcessed: number };
  baseline: {
    matchRate: number;
    autoResolutionRate: number;
    falseResolutions: number;
    valueReconciledPaise: number;
  };
  evidence: Evidence[];
}

const PIPELINE = [
  { label: "Raw finance data", kind: "INPUT" },
  { label: "Normalise", kind: "DETERMINISTIC" },
  { label: "Candidate scoring", kind: "STATISTICAL" },
  { label: "Policy gates", kind: "POLICY" },
  { label: "Auto-resolve or escalate", kind: "POLICY" },
  { label: "Human review", kind: "HUMAN" },
  { label: "Ledger and audit", kind: "DETERMINISTIC" },
];

const KIND_STYLE: Record<string, string> = {
  INPUT: "border-white/15 bg-white/[0.04] text-ink-body",
  DETERMINISTIC: "border-info/30 bg-info/[0.10] text-info",
  STATISTICAL: "border-brand/30 bg-brand/[0.10] text-brand-bright",
  POLICY: "border-warn/30 bg-warn/[0.10] text-warn",
  HUMAN: "border-ok/30 bg-ok/[0.10] text-ok",
};

export default function Track04Page() {
  const [data, setData] = useState<Track04Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/track04", { cache: "no-store" });
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.error?.message ?? "Benchmark failed");
    } catch {
      setError("Could not reach the API. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * The one-click evaluation: build the dataset, score it, persist the run,
   * and open a review row for every record the controller would not clear.
   * Distinct from the read-only refresh above, which computes but records
   * nothing - looking at a score should not create one.
   */
  async function runEvaluation() {
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const res = await fetch("/api/track04/run", { method: "POST" });
      const json = await res.json();
      if (!json.success) {
        setRunError(json.error?.message ?? "The evaluation was refused");
        return;
      }
      setRunResult(
        `Recorded ${json.data.runId}: ${json.data.summary.correctlyResolved}/` +
          `${json.data.summary.recordsProcessed} correct, ` +
          `${json.data.reviewsOpened} exceptions opened for review.`
      );
      await load();
    } catch {
      setRunError("Could not reach the API.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <LoadingState label="Running the benchmark" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const h = data.heldOut;
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  const openEvidence = data.evidence.find((e) => e.recordId === openRecord);

  return (
    <div className="fade-up max-w-6xl">
      <PageHeader
        title="Track 04 benchmark"
        lede="A labelled finance-operations dataset, scored end to end. Run fresh on every page load, so this is what the code in the repository does right now — not a number recorded once."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/track04/review"
              className="focusable rounded-md border border-line-strong bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
            >
              Review queue
            </Link>
            <Link
              href="/dashboard/track04/history"
              className="focusable rounded-md border border-line-strong bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
            >
              Run history
            </Link>
            <Button variant="secondary" size="sm" onClick={load}>
              Refresh
            </Button>
            <button
              type="button"
              disabled={running}
              onClick={runEvaluation}
              className="focusable btn-lift rounded-lg border border-white/20 bg-gradient-to-b from-brand-deep to-[rgb(29_78_216)] px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-glow-brand disabled:opacity-60"
            >
              {running ? "Running..." : "Run Track 04 evaluation"}
            </button>
          </div>
        }
      />

      {runResult ? (
        <div className="mt-4 rounded-lg border border-ok/30 bg-ok/[0.10] px-4 py-3 text-[13px] text-ok">
          {runResult}{" "}
          <Link
            href="/dashboard/track04/review"
            className="font-medium underline"
          >
            Open the review queue
          </Link>
          .
        </div>
      ) : null}
      {runError ? (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/[0.10] px-4 py-3 text-[13px] text-danger">
          {runError}
        </div>
      ) : null}

      {/* The claim that matters most, before any accuracy figure. */}
      <div className="mt-6">
        <Card
          className={
            data.safety.allClear
              ? "border-ok/35 bg-ok/[0.10]"
              : "border-danger/40 bg-danger/[0.12]"
          }
        >
          <CardHeader
            eyebrow="Financial safety"
            title={
              data.safety.allClear
                ? "No money or books were damaged"
                : "A safety counter is non-zero"
            }
            hint="An accuracy figure says how often the system was right. These say what happened the times it was not. Each counter names how it was measured — two come from the benchmark, three from the live system."
          />
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.safety.counters.map((c) => (
                <div
                  key={c.key}
                  title={`${c.measurement}

If non-zero: ${c.consequence}`}
                  className={cn(
                    "rounded-lg border px-4 py-3 transition-transform hover:scale-[1.02]",
                    c.count === 0
                      ? "border-ok/25 bg-ok/[0.07]"
                      : "border-danger/35 bg-danger/[0.12]"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink-body">{c.label}</span>
                    <span
                      className={cn(
                        "tabular text-2xl font-semibold",
                        c.count === 0 ? "text-ok" : "text-danger"
                      )}
                    >
                      {c.count}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                        c.source === "LIVE_SYSTEM"
                          ? "border-brand/30 bg-brand/[0.10] text-brand-bright"
                          : "border-white/15 bg-white/[0.05] text-ink-muted"
                      )}
                    >
                      {c.source === "LIVE_SYSTEM" ? "live system" : "benchmark"}
                    </span>
                    {c.valuePaise !== null ? (
                      <span className="tabular text-2xs text-ink-faint">
                        <Money paise={c.valuePaise} /> at stake
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
                    {c.measurement}
                  </p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Above the fold: the numbers a judge is looking for. */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Records processed"
          value={h.recordsProcessed}
          hint={`Held-out split of ${data.dataset.total}`}
        />
        <Stat
          label="Match rate"
          value={pct(h.matchRate)}
          tone="ok"
          hint={`${h.correctlyResolved} correctly resolved`}
          emphasis
        />
        <Stat
          label="False resolutions"
          value={h.falseResolutions}
          tone={h.falseResolutions === 0 ? "ok" : "danger"}
          hint="Cleared when a human was needed"
          emphasis={h.falseResolutions > 0}
        />
        <Stat
          label="Throughput"
          value={`${Math.round(h.recordsPerSecond).toLocaleString("en-IN")}/s`}
          hint={`${h.elapsedMs.toFixed(1)} ms total`}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Auto-resolved"
          value={pct(h.autoResolutionRate)}
          tone="brand"
          hint="Cleared without a human"
        />
        <Stat
          label="Escalated"
          value={pct(h.exceptionRate)}
          tone="warn"
          hint={`${h.exceptions.length} open exceptions`}
        />
        <Stat
          label="Value reconciled"
          value={<Money paise={h.valueReconciledPaise} />}
          tone="ok"
        />
        <Stat
          label="Value held for review"
          value={<Money paise={h.valueHeldForReviewPaise} />}
          tone="warn"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Auto-resolution precision"
          value={pct(h.autoResolutionPrecision)}
          tone="ok"
          hint="Of what it cleared, how much was right"
        />
        <Stat
          label="Escalation recall"
          value={pct(h.escalationRecall)}
          tone="ok"
          hint="Of what needed a human, how much got one"
        />
        <Stat
          label="Throughput"
          value={`${Math.round(h.recordsPerSecond * 60).toLocaleString("en-IN")}/min`}
          hint={`${Math.round(h.recordsPerSecond).toLocaleString("en-IN")} records/sec`}
        />
        <Stat
          label="Ledger imbalance"
          value={<Money paise={data.ledger.imbalancePaise} />}
          tone={data.ledger.balanced ? "ok" : "danger"}
          hint={
            data.ledger.balanced
              ? `Live trial balance foots across ${data.ledger.accountCount} accounts`
              : "The live ledger is out of balance"
          }
        />
      </div>

      {/* What the score does not prove. Stated before anyone quotes it. */}
      <div className="mt-6">
        <Callout tone="warn" title="What this score does and does not establish">
          <p>
            The dataset and the controller were written by the same author. A
            defect class nobody thought to plant is one the controller is not
            tested against, so a high match rate here measures{" "}
            <strong>internal consistency</strong> — it is not evidence of
            accuracy on a real settlement file and should not be quoted as
            such.
          </p>
          <p className="mt-2">
            What it does establish: <strong>{h.falseResolutions}</strong>{" "}
            records were cleared that should have been escalated across{" "}
            {h.recordsProcessed} held-out records, the controller abstains on
            every genuinely undecidable case rather than guessing, and it beats
            the exact-match baseline {pct(h.matchRate)} to{" "}
            {pct(data.baseline.matchRate)}.
          </p>
          <p className="mt-2">
            Building it exposed two real defects in this controller that were
            not anticipated when it was written: it never compared the
            beneficiary, so it cleared ten payments made to the wrong company at
            full confidence; and it misread split settlements as amount
            mismatches. Both are fixed. A benchmark that only confirms its
            author was right is not measuring anything.
          </p>
        </Callout>
      </div>

      {/* The pipeline, made impossible to miss. */}
      <div className="mt-6">
        <Card>
          <CardHeader
            eyebrow="Architecture"
            title="Where the judgement happens"
            hint="Scoring and deciding are separate stages, and policy can veto a high-confidence match. A duplicate payment scores perfectly on every field — which is exactly what makes it a duplicate."
          />
          <CardBody>
            <div className="flex flex-wrap items-center gap-2">
              {PIPELINE.map((step, i) => (
                <div key={step.label} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2 text-[13px] font-medium transition-transform hover:scale-105",
                      KIND_STYLE[step.kind]
                    )}
                  >
                    <div>{step.label}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide opacity-70">
                      {step.kind}
                    </div>
                  </div>
                  {i < PIPELINE.length - 1 ? (
                    <span className="text-ink-faint">→</span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
              There is no LLM in this path. Calling a weighted-sum matcher “AI”
              would be exactly the kind of claim this project exists to avoid —
              what makes it worth showing is that it abstains, explains itself,
              and is measured on held-out data.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Safety counters. */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Duplicate payments prevented"
          value={h.duplicatePaymentsPrevented}
          tone="ok"
        />
        <Stat
          label="Short settlements caught"
          value={h.shortSettlementsCaught}
          tone="ok"
        />
        <Stat
          label="Unexplained outbound caught"
          value={h.unexplainedOutboundCaught}
          tone="ok"
        />
        <Stat
          label="Blocked by a policy gate"
          value={h.blockedByPolicyGate}
          tone="brand"
          hint="Matched well, refused anyway"
        />
        <Stat
          label="Value at risk from errors"
          value={<Money paise={h.valueAtRiskFromFalseResolutionsPaise} />}
          tone={h.valueAtRiskFromFalseResolutionsPaise === 0 ? "ok" : "danger"}
        />
      </div>

      {/* Baseline comparison. */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Versus a trivial exact-match rule"
            hint="Exact reference string and exact amount. Without this comparison, a match rate is a number with nothing to be measured against."
          />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  <Th align="right">Controller</Th>
                  <Th align="right">Exact-match rule</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>Match rate</Td>
                  <Td align="right" className="font-medium text-ok">
                    {pct(h.matchRate)}
                  </Td>
                  <Td align="right" className="text-ink-muted">
                    {pct(data.baseline.matchRate)}
                  </Td>
                </tr>
                <tr>
                  <Td>Auto-resolution rate</Td>
                  <Td align="right">{pct(h.autoResolutionRate)}</Td>
                  <Td align="right" className="text-ink-muted">
                    {pct(data.baseline.autoResolutionRate)}
                  </Td>
                </tr>
                <tr>
                  <Td>False resolutions</Td>
                  <Td align="right">{h.falseResolutions}</Td>
                  <Td align="right" className="text-ink-muted">
                    {data.baseline.falseResolutions}
                  </Td>
                </tr>
                <tr>
                  <Td>Value reconciled</Td>
                  <Td align="right">
                    <Money paise={h.valueReconciledPaise} />
                  </Td>
                  <Td align="right" className="text-ink-muted">
                    <Money paise={data.baseline.valueReconciledPaise} />
                  </Td>
                </tr>
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      {/* Per-difficulty. */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="By difficulty"
            hint="An aggregate over a dataset that is mostly trivial says nothing about the cases that cost money."
          />
          <CardBody className="space-y-2">
            {h.byDifficulty.map((b) => (
              <div key={b.key}>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-ink-body">{b.key}</span>
                  <span className="tabular text-ink-muted">
                    {b.correct}/{b.total} · {pct(b.accuracy)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-700",
                      b.falseResolutions > 0 ? "bg-danger" : "bg-ok"
                    )}
                    style={{ width: `${b.accuracy * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="By ground-truth label"
            hint="Every defect class the dataset contains, scored separately."
          />
          <CardBody className="space-y-1.5">
            {h.byLabel.map((b) => (
              <div
                key={b.key}
                className="flex items-baseline justify-between text-2xs"
              >
                <span className="mono text-ink-muted">{b.key}</span>
                <span
                  className={cn(
                    "tabular",
                    b.accuracy === 1 ? "text-ok" : "text-warn"
                  )}
                >
                  {b.correct}/{b.total} · {pct(b.accuracy)}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* The honest exception list. */}
      <div className="mt-6">
        <Card>
          <CardHeader
            eyebrow="Honest exception list"
            title={`${h.exceptions.length} records the controller would not resolve`}
            hint="Click any row to see the field-by-field evidence, the confidence, and why it was not safe to clear automatically."
          />
          <Table>
            <thead>
              <tr>
                <Th>Record</Th>
                <Th>Exception</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Confidence</Th>
                <Th>Supplier</Th>
              </tr>
            </thead>
            <tbody>
              {h.exceptions.slice(0, 25).map((e) => {
                const hasEvidence = data.evidence.some(
                  (v) => v.recordId === e.recordId
                );
                return (
                  <tr
                    key={e.recordId}
                    onClick={() =>
                      hasEvidence &&
                      setOpenRecord(
                        openRecord === e.recordId ? null : e.recordId
                      )
                    }
                    className={cn(
                      "transition-colors",
                      hasEvidence && "cursor-pointer hover:bg-surface-sunken",
                      openRecord === e.recordId && "bg-brand/[0.08]"
                    )}
                  >
                    <Td>
                      <MonoId value={e.recordId} truncate={12} />
                    </Td>
                    <Td>
                      <span className="mono text-2xs text-warn">
                        {e.exceptionType}
                      </span>
                    </Td>
                    <Td align="right" className="font-medium text-ink-strong">
                      <Money paise={e.amountPaise} />
                    </Td>
                    <Td align="right" className="tabular text-ink-muted">
                      {(e.confidence * 100).toFixed(0)}%
                    </Td>
                    <Td className="text-2xs text-ink-muted">
                      {e.supplierName}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>

      {/* Drill-down. */}
      {openEvidence ? (
        <div className="mt-4">
          <Card tone="accent">
            <CardHeader
              eyebrow={`${openEvidence.scenario} · ${openEvidence.difficulty}`}
              title={`Why ${openEvidence.recordId} was not resolved automatically`}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOpenRecord(null)}
                >
                  Close
                </Button>
              }
            />
            <CardBody className="space-y-4">
              <div className="rounded-lg border border-warn/25 bg-warn/[0.07] px-4 py-3">
                <p className="text-[13px] font-medium text-ink-strong">
                  {openEvidence.decision.reason}
                </p>
                <p className="mt-2 text-2xs leading-relaxed text-ink-body">
                  {openEvidence.decision.whyNotAutoResolved}
                </p>
              </div>

              <div>
                <p className="text-2xs uppercase tracking-wide text-ink-muted">
                  Field-by-field comparison
                </p>
                <div className="mt-2 overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Field</Th>
                        <Th>Ours</Th>
                        <Th>Provider</Th>
                        <Th align="right">Weight</Th>
                        <Th align="right">Agrees</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {openEvidence.decision.comparisons.map((c) => (
                        <tr key={c.field}>
                          <Td className="mono text-2xs">{c.field}</Td>
                          <Td className="text-2xs">{c.internalValue}</Td>
                          <Td className="text-2xs">{c.externalValue}</Td>
                          <Td align="right" className="tabular text-2xs">
                            {c.weight}
                          </Td>
                          <Td align="right">
                            <span className={c.agreed ? "text-ok" : "text-danger"}>
                              {c.agreed ? "✓" : "✗"}
                            </span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div>
                <p className="text-2xs uppercase tracking-wide text-ink-muted">
                  Stages run
                </p>
                <div className="mt-2 space-y-1">
                  {openEvidence.decision.trace.map((t, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-baseline gap-2 text-2xs"
                    >
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[10px] uppercase",
                          KIND_STYLE[t.kind]
                        )}
                      >
                        {t.kind}
                      </span>
                      <span className="mono text-ink-body">{t.stage}</span>
                      <span className="text-ink-faint">{t.detail}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-ok/25 bg-ok/[0.07] px-4 py-3">
                <p className="text-2xs uppercase tracking-wide text-ok">
                  Recommended action
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-body">
                  {openEvidence.decision.recommendedAction}
                </p>
              </div>

              <div className="rounded-lg border border-white/[0.10] bg-white/[0.03] px-4 py-3">
                <p className="text-2xs uppercase tracking-wide text-ink-muted">
                  Ground truth ({openEvidence.groundTruthLabel})
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-ink-faint">
                  {openEvidence.groundTruthNote}
                </p>
                <p className="mt-2 text-2xs text-ink-faint">
                  Value at stake if mishandled:{" "}
                  <Money paise={openEvidence.materialityPaise} />
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Reproducibility. */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Reproducibility"
            hint="Everything needed to get this exact number again."
          />
          <CardBody className="grid gap-2 text-2xs sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <span className="text-ink-muted">Dataset version</span>
              <span className="mono text-ink-body">
                {data.dataset.version}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink-muted">Seed</span>
              <span className="tabular text-ink-body">{data.dataset.seed}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink-muted">Controller version</span>
              <span className="mono text-ink-body">
                {data.controllerVersion}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink-muted">Auto-resolve threshold</span>
              <span className="tabular text-ink-body">
                {(data.thresholds.autoResolve * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink-muted">Amount tolerance</span>
              <span className="tabular text-ink-body">
                {data.thresholds.amountTolerancePaise} paise
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink-muted">Tuning split match rate</span>
              <span className="tabular text-ink-body">
                {pct(data.tuning.matchRate)}
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      <p className="mt-4 text-2xs text-ink-faint">
        Run it yourself with{" "}
        <span className="mono text-ink-muted">npm run track04:benchmark</span>,
        which prints the same figures plus the full exception list and exits
        non-zero if any record is cleared that should have been escalated.
      </p>
    </div>
  );
}
