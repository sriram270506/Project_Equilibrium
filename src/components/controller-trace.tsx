"use client";

import { Card, CardHeader, CardBody, Callout, MonoId } from "./ui/primitives";
import { cn } from "@/src/lib/utils";
import {
  toolDefinition,
  summariseNature,
  WITHHELD_CAPABILITIES,
  type ToolNature,
} from "@/src/lib/controller/tool-catalogue";

/**
 * The controller's reasoning, shown as steps rather than as a paragraph.
 *
 * A block of generated prose is unfalsifiable — a reader cannot tell whether it
 * reflects what the system actually did. Rendering each tool call with its
 * arguments and its return value makes the run checkable: you can see what was
 * read, in what order, and where it stopped.
 */

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: "SUCCEEDED" | "STOPPED";
}

interface TraceProps {
  traceId: string;
  status: "COMPLETED" | "STOPPED";
  recommendation: string;
  stopReason: string | null;
  toolCalls: ToolCall[];
  facts?: Record<string, unknown>;
}

const NATURE_STYLE: Record<
  ToolNature,
  { label: string; chip: string; dot: string }
> = {
  DETERMINISTIC: {
    label: "Computed",
    chip: "border-ok/35 bg-ok/[0.12] text-ok",
    dot: "bg-ok",
  },
  MODEL: {
    label: "Predicted",
    chip: "border-warn/35 bg-warn/[0.12] text-warn",
    dot: "bg-warn",
  },
  POLICY: {
    label: "Policy rule",
    chip: "border-info/35 bg-info/[0.12] text-info",
    dot: "bg-info",
  },
};

export function ControllerTrace({
  traceId,
  status,
  recommendation,
  stopReason,
  toolCalls,
}: TraceProps) {
  const nature = summariseNature(toolCalls.map((c) => c.name));
  const stopped = status === "STOPPED";

  return (
    <Card>
      <CardHeader
        eyebrow="Controller run"
        title={
          stopped
            ? "The controller stopped and handed this back"
            : "The controller completed its assessment"
        }
        hint="Every step below is a real, typed, read-only tool call with its arguments and its return value. Nothing here is generated prose."
        action={
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-md",
                stopped
                  ? "border-warn/35 bg-warn/[0.14] text-warn"
                  : "border-ok/35 bg-ok/[0.14] text-ok"
              )}
            >
              {recommendation.replace(/_/g, " ").toLowerCase()}
            </span>
            <p className="mt-1.5 text-2xs text-ink-faint">
              <MonoId value={traceId} truncate={16} />
            </p>
          </div>
        }
      />

      <CardBody className="space-y-5">
        {/* Abstention is a first-class outcome, not an error. */}
        {stopped && stopReason ? (
          <Callout tone="warn" title="Why it stopped">
            <p className="mono mb-1.5 text-[11px] text-warn">{stopReason}</p>
            <p>
              The controller is bounded: when a case falls outside what it may
              decide, it halts and returns it to a human rather than producing a
              confident answer anyway. Stopping is the designed behaviour here,
              not a failure.
            </p>
          </Callout>
        ) : null}

        {/* How much of this outcome is computed vs predicted. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3">
          <span className="text-2xs font-medium uppercase tracking-wider text-ink-muted">
            Evidence mix
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <NatureChip nature="DETERMINISTIC" count={nature.deterministic} />
            <NatureChip nature="POLICY" count={nature.policy} />
            <NatureChip nature="MODEL" count={nature.model} />
          </span>
          <p className="w-full text-[13px] leading-relaxed text-ink-muted">
            {nature.fullyDeterministic
              ? "No probabilistic step contributed to this outcome. Every input was computed or looked up, so the conclusion is checkable line by line."
              : `${nature.model} of ${toolCalls.length} steps came from a fitted model and carry error. The rest are arithmetic, lookups, or declared policy thresholds.`}
          </p>
        </div>

        {/* The run itself. */}
        <ol className="space-y-2.5">
          {toolCalls.map((call, i) => {
            const def = toolDefinition(call.name);
            const natureStyle = def ? NATURE_STYLE[def.nature] : null;
            const halted = call.status === "STOPPED";

            return (
              <li
                key={`${call.name}-${i}`}
                className={cn(
                  "rounded-lg border bg-white/[0.03] p-4 transition-colors",
                  halted
                    ? "border-warn/30"
                    : "border-white/[0.08] hover:border-white/[0.16]"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="tabular mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] text-2xs font-semibold text-ink-muted">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="mono text-[13px] font-medium text-ink-strong">
                        {call.name}
                      </p>
                      {def ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                          {def.interpretation}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {natureStyle ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-0.5 text-2xs font-medium",
                        natureStyle.chip
                      )}
                    >
                      {natureStyle.label}
                    </span>
                  ) : null}
                </div>

                {/* Arguments in, values out. */}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <IoBlock label="Called with" payload={call.input} />
                  <IoBlock label="Returned" payload={call.output} />
                </div>

                {def ? (
                  <p className="mt-2.5 text-2xs leading-relaxed text-ink-faint">
                    <span className="text-ink-muted">Cannot:</span> {def.cannot}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* The boundary, stated rather than implied. */}
        <div>
          <p className="eyebrow mb-2">What this controller is not allowed to do</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {WITHHELD_CAPABILITIES.map((w) => (
              <li
                key={w.capability}
                className="flex gap-2 text-[13px] leading-snug text-ink-muted"
              >
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-danger" />
                <span>
                  <span className="text-ink-body">{w.capability}</span> — {w.why}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
            These are absent from the tool set rather than forbidden by
            instruction. A prompt asking a model not to do something is a
            request; a function that does not exist is a guarantee.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function NatureChip({
  nature,
  count,
}: {
  nature: ToolNature;
  count: number;
}) {
  if (count === 0) return null;
  const style = NATURE_STYLE[nature];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-medium",
        style.chip
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {count} {style.label.toLowerCase()}
    </span>
  );
}

function IoBlock({
  label,
  payload,
}: {
  label: string;
  payload: Record<string, unknown>;
}) {
  const entries = Object.entries(payload ?? {});
  return (
    <div className="rounded-md border border-white/[0.07] bg-canvas-deep/60 px-3 py-2">
      <p className="text-2xs font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </p>
      {entries.length === 0 ? (
        <p className="mono mt-1 text-[11px] text-ink-faint">(nothing)</p>
      ) : (
        <dl className="mt-1.5 space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className="mono text-[11px] text-ink-faint">{key}</dt>
              <dd className="mono tabular text-right text-[11px] text-ink-body">
                {formatValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString("en-IN") : value.toFixed(3);
  }
  if (Array.isArray(value)) return value.length ? value.join(", ") : "[]";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
