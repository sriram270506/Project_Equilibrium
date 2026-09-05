"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Money,
  Button,
  LoadingState,
  ErrorState,
  EmptyState,
  Table,
  Th,
  Td,
  MonoId,
  Callout,
} from "@/src/components/ui/primitives";
import { cn } from "@/src/lib/utils";

/**
 * Every recorded evaluation.
 *
 * The version columns are the reason this page exists. A match rate on its own
 * cannot tell you whether a fall came from the data or the code — the same
 * number beside a changed dataset version means something entirely different
 * from the same number beside a changed controller version.
 */

interface Run {
  id: string;
  runAt: string;
  operator: string;
  datasetVersion: string;
  datasetSeed: number;
  controllerVersion: string;
  split: string;
  recordsProcessed: number;
  matchRate: number;
  autoResolutionRate: number;
  exceptionRate: number;
  autoResolutionPrecision: number;
  falseResolutions: number;
  missedMatches: number;
  recordsPerSecond: number;
  elapsedMs: number;
  valueReconciledPaise: number;
  valueHeldForReviewPaise: number;
  ledgerBalanced: boolean;
  ledgerImbalancePaise: number;
  exceptionCount: number;
  exceptionsOpen: number;
  exceptionsResolved: number;
}

export default function Track04HistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/track04/runs", { cache: "no-store" });
      const json = await res.json();
      if (json.success) setRuns(json.data.runs);
      else setError(json.error?.message ?? "Failed to load run history");
    } catch {
      setError("Could not reach the API. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="Loading run history" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!runs) return null;

  const pct = (x: number) => (x * 100).toFixed(1) + "%";

  // Version changes are what make a metric change interpretable, so mark them.
  const versionChanges = new Set<string>();
  for (let i = 0; i < runs.length - 1; i++) {
    const newer = runs[i];
    const older = runs[i + 1];
    if (
      newer.datasetVersion !== older.datasetVersion ||
      newer.controllerVersion !== older.controllerVersion
    ) {
      versionChanges.add(newer.id);
    }
  }

  return (
    <div className="fade-up max-w-6xl">
      <PageHeader
        title="Benchmark run history"
        lede="Every recorded evaluation, with the dataset and controller versions it ran against. A score with no history is a claim; a series is a measurement."
        action={
          <div className="flex gap-2">
            <Link
              href="/dashboard/track04"
              className="focusable rounded-md border border-line-strong bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-strong hover:bg-surface-sunken"
            >
              Back to benchmark
            </Link>
            <Button variant="secondary" size="sm" onClick={load}>
              Refresh
            </Button>
          </div>
        }
      />

      {runs.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No evaluations recorded yet">
            Press <strong>Run Track 04 evaluation</strong> on the{" "}
            <Link
              href="/dashboard/track04"
              className="font-medium text-brand hover:underline"
            >
              benchmark page
            </Link>
            , or run{" "}
            <span className="mono text-ink-muted">
              npm run track04:benchmark -- --record
            </span>{" "}
            from a terminal.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <Callout tone="info" title="How to read this table">
              A change in match rate only means something once you know what
              else changed. When the dataset or controller version differs from
              the run below it, the row is marked — comparing scores across a
              version boundary is comparing two different measurements.
            </Callout>
          </div>

          <div className="mt-6">
            <Card>
              <CardHeader
                title={`${runs.length} recorded ${runs.length === 1 ? "run" : "runs"}`}
                hint="Newest first. Exceptions open versus resolved shows how much of each run a human has actually worked through."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Run</Th>
                    <Th>When</Th>
                    <Th>Operator</Th>
                    <Th align="right">Records</Th>
                    <Th align="right">Match</Th>
                    <Th align="right">Precision</Th>
                    <Th align="right">False res.</Th>
                    <Th align="right">Exceptions</Th>
                    <Th align="right">Reconciled</Th>
                    <Th>Ledger</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className={cn(
                        "hover:bg-surface-sunken",
                        versionChanges.has(run.id) &&
                          "border-l-2 border-l-warn bg-warn/[0.04]"
                      )}
                    >
                      <Td>
                        <MonoId value={run.id} truncate={14} />
                        {versionChanges.has(run.id) ? (
                          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-warn">
                            version changed
                          </div>
                        ) : null}
                      </Td>
                      <Td className="tabular text-2xs text-ink-muted">
                        {new Date(run.runAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </Td>
                      <Td className="text-2xs text-ink-muted">
                        {run.operator}
                      </Td>
                      <Td align="right" className="tabular">
                        {run.recordsProcessed}
                      </Td>
                      <Td
                        align="right"
                        className={cn(
                          "tabular font-medium",
                          run.matchRate >= 0.95 ? "text-ok" : "text-warn"
                        )}
                      >
                        {pct(run.matchRate)}
                      </Td>
                      <Td align="right" className="tabular text-ink-body">
                        {pct(run.autoResolutionPrecision)}
                      </Td>
                      <Td
                        align="right"
                        className={cn(
                          "tabular",
                          run.falseResolutions === 0
                            ? "text-ok"
                            : "font-semibold text-danger"
                        )}
                      >
                        {run.falseResolutions}
                      </Td>
                      <Td align="right" className="tabular text-2xs">
                        <span className="text-warn">{run.exceptionsOpen}</span>
                        <span className="text-ink-faint"> open / </span>
                        <span className="text-ok">
                          {run.exceptionsResolved}
                        </span>
                        <span className="text-ink-faint"> done</span>
                      </Td>
                      <Td align="right" className="tabular text-2xs">
                        <Money paise={run.valueReconciledPaise} />
                      </Td>
                      <Td>
                        <span
                          className={
                            run.ledgerBalanced ? "text-ok" : "text-danger"
                          }
                        >
                          {run.ledgerBalanced ? "✓ foots" : "✗ out"}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          {/* Provenance for the most recent run, spelled out. */}
          <div className="mt-6">
            <Card>
              <CardHeader
                title="Latest run provenance"
                hint="Everything needed to reproduce that row exactly."
              />
              <CardBody className="grid gap-2 text-2xs sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <span className="text-ink-muted">Dataset version</span>
                  <span className="mono text-ink-body">
                    {runs[0].datasetVersion}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-ink-muted">Dataset seed</span>
                  <span className="tabular text-ink-body">
                    {runs[0].datasetSeed}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-ink-muted">Controller version</span>
                  <span className="mono text-ink-body">
                    {runs[0].controllerVersion}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-ink-muted">Split reported</span>
                  <span className="mono text-ink-body">{runs[0].split}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-ink-muted">Throughput</span>
                  <span className="tabular text-ink-body">
                    {Math.round(runs[0].recordsPerSecond).toLocaleString(
                      "en-IN"
                    )}
                    /sec
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-ink-muted">Ledger imbalance</span>
                  <span className="tabular text-ink-body">
                    <Money paise={runs[0].ledgerImbalancePaise} />
                  </span>
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
