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
  DataRow,
  MonoId,
  LoadingState,
  ErrorState,
} from "@/src/components/ui/primitives";
import { cn } from "@/src/lib/utils";

interface RiskData {
  limits: {
    killSwitchEngaged: boolean;
    killSwitchReason: string | null;
    killSwitchEngagedBy: string | null;
    killSwitchEngagedAt: string | null;
    dailyExposureLimitPaise: number;
    perTransactionCapPaise: number;
    dualApprovalThresholdPaise: number;
    perSupplierLimitPaise: number;
  };
  exposure: {
    todayPaise: number;
    remainingPaise: number;
    utilisation: number;
    limitPaise: number;
    paymentsToday: number;
  };
}

interface AuditData {
  verification: {
    valid: boolean;
    entriesChecked: number;
    firstBreak: {
      sequence: number;
      eventType: string;
      reason: string;
      detail: string;
    } | null;
    headHash: string | null;
  };
  total: number;
  entries: Array<{
    sequence: number;
    eventType: string;
    actorId: string;
    actorType: string;
    createdAt: string;
    entryHash: string;
  }>;
}

const ADMIN_KEY = "key_admin_demo_12345";

export default function ControlsPage() {
  const [risk, setRisk] = useState<RiskData | null>(null);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [riskRes, auditRes] = await Promise.all([
        fetch("/api/risk", { cache: "no-store" }),
        fetch("/api/audit?limit=12", { cache: "no-store" }),
      ]);
      const riskJson = await riskRes.json();
      const auditJson = await auditRes.json();

      if (riskJson.success) setRisk(riskJson.data);
      else setError(riskJson.error?.message ?? "Failed to load risk controls");

      if (auditJson.success) setAudit(auditJson.data);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleKillSwitch(engage: boolean) {
    setBusy("kill");
    setMessage(null);
    try {
      const res = await fetch("/api/risk", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ADMIN_KEY,
        },
        body: JSON.stringify({
          killSwitchEngaged: engage,
          killSwitchReason: engage
            ? "Halted manually from the controls console"
            : undefined,
        }),
      });
      const json = await res.json();
      setMessage(
        json.success
          ? engage
            ? "Kill switch engaged. No payment can be submitted to the provider until it is released."
            : "Kill switch released. Payments may flow again."
          : (json.error?.message ?? "Failed")
      );
      await load();
    } catch {
      setMessage("Could not reach the API.");
    } finally {
      setBusy(null);
    }
  }

  async function tamperWithAudit() {
    setBusy("tamper");
    setMessage(null);
    try {
      const target = audit?.entries[audit.entries.length - 1]?.sequence ?? 1;
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ADMIN_KEY,
        },
        body: JSON.stringify({ sequence: target }),
      });
      const json = await res.json();
      setMessage(
        json.success
          ? `Audit entry #${target} was edited directly in the database. ${json.data.verification.firstBreak?.detail ?? ""}`
          : (json.error?.message ?? "Failed")
      );
      await load();
    } catch {
      setMessage("Could not reach the API.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingState label="Loading controls" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!risk) return null;

  const { limits, exposure } = risk;
  const utilisationPct = Math.round(exposure.utilisation * 100);

  return (
    <div className="fade-up max-w-4xl">
      <PageHeader
        title="Risk controls"
        lede="The limits that hold regardless of what the model believes. A model can drift and an operator can be misled; none of that may result in more money leaving than the business has decided it can lose in a day."
        action={
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
        }
      />

      {message ? (
        <div className="mb-4">
          <Callout tone="info">{message}</Callout>
        </div>
      ) : null}

      {/* Kill switch */}
      <Card
        className={cn(
          "mb-4",
          limits.killSwitchEngaged
            ? "border-danger/40 bg-danger/[0.12]"
            : "border-line-soft"
        )}
      >
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  limits.killSwitchEngaged ? "bg-danger pulse-ring" : "bg-ok"
                )}
              />
              <p className="text-base font-semibold text-ink-strong">
                {limits.killSwitchEngaged
                  ? "Payments are halted"
                  : "Payments are flowing normally"}
              </p>
            </div>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-body">
              {limits.killSwitchEngaged
                ? `${limits.killSwitchReason ?? "No reason recorded"} — engaged by ${limits.killSwitchEngagedBy ?? "unknown"}. Every approval attempt is refused while this is on.`
                : "One switch stops every outbound payment immediately, without a deploy. The moment you need this is never the moment you can wait for a release."}
            </p>
          </div>
          <Button
            variant={limits.killSwitchEngaged ? "primary" : "danger"}
            onClick={() => toggleKillSwitch(!limits.killSwitchEngaged)}
            disabled={busy === "kill"}
          >
            {busy === "kill"
              ? "Working…"
              : limits.killSwitchEngaged
                ? "Release the kill switch"
                : "Halt all payments"}
          </Button>
        </CardBody>
      </Card>

      {/* Daily exposure */}
      <Card className="mb-4">
        <CardHeader
          title="Today's exposure"
          hint="Counts every payment that is not definitively failed, including those with an unknown outcome — a limit that ignored those could be breached by a run of timeouts."
        />
        <CardBody className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="tabular text-2xl font-semibold text-ink-strong">
              <Money paise={exposure.todayPaise} />
            </p>
            <p className="text-[13px] text-ink-muted">
              of <Money paise={exposure.limitPaise} /> daily limit
            </p>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                utilisationPct > 85
                  ? "bg-danger"
                  : utilisationPct > 60
                    ? "bg-warn"
                    : "bg-ok"
              )}
              style={{ width: `${Math.max(utilisationPct, 1)}%` }}
            />
          </div>

          <div className="flex justify-between text-[13px] text-ink-muted">
            <span>
              {utilisationPct}% used across {exposure.paymentsToday} payment
              {exposure.paymentsToday === 1 ? "" : "s"}
            </span>
            <span>
              <Money paise={exposure.remainingPaise} /> remaining
            </span>
          </div>
        </CardBody>
      </Card>

      {/* Limits */}
      <Card className="mb-4">
        <CardHeader
          title="Active limits"
          hint="Enforced before any money moves, not after."
        />
        <CardBody>
          <DataRow
            label="Daily exposure limit"
            hint="total advanced across all suppliers in one day"
          >
            <Money paise={limits.dailyExposureLimitPaise} />
          </DataRow>
          <DataRow label="Per-transaction cap" hint="largest single advance">
            <Money paise={limits.perTransactionCapPaise} />
          </DataRow>
          <DataRow
            label="Dual-approval threshold"
            hint="at or above this, a second operator must confirm"
          >
            <Money paise={limits.dualApprovalThresholdPaise} />
          </DataRow>
          <DataRow
            label="Per-supplier limit"
            hint="most that may be outstanding to one supplier"
          >
            <Money paise={limits.perSupplierLimitPaise} />
          </DataRow>
        </CardBody>
      </Card>

      {/* Audit chain */}
      {audit ? (
        <Card
          className={cn(
            audit.verification.valid ? "border-ok/30" : "border-danger/40"
          )}
        >
          <CardHeader
            eyebrow="Tamper evidence"
            title="Audit chain"
            hint="Each entry hashes its own content together with the previous entry's hash. Editing any historical row breaks every hash after it."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={tamperWithAudit}
                disabled={busy === "tamper"}
              >
                {busy === "tamper" ? "Tampering…" : "Tamper with a record"}
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <div
              className={cn(
                "flex items-center gap-3 rounded-md border px-4 py-3",
                audit.verification.valid
                  ? "border-ok/30 bg-ok/[0.12]"
                  : "border-danger/30 bg-danger/[0.12]"
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-white",
                  audit.verification.valid ? "bg-ok" : "bg-danger"
                )}
              >
                {audit.verification.valid ? "✓" : "!"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-strong">
                  {audit.verification.valid
                    ? `Chain verified across all ${audit.total} entries`
                    : `Chain broken at entry #${audit.verification.firstBreak?.sequence}`}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-body">
                  {audit.verification.valid
                    ? "No audit record has been altered since it was written."
                    : audit.verification.firstBreak?.detail}
                </p>
              </div>
            </div>

            <div>
              <p className="eyebrow mb-2">Most recent entries</p>
              <ul className="space-y-1.5">
                {audit.entries.slice(0, 6).map((e) => (
                  <li
                    key={e.sequence}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="tabular w-8 shrink-0 text-2xs text-ink-muted">
                        #{e.sequence}
                      </span>
                      <span className="truncate text-ink-body">
                        {e.eventType}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-2xs text-ink-muted">
                        {e.actorId}
                      </span>
                      <MonoId value={e.entryHash} truncate={10} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <Callout tone="info" title="What this does and does not prove">
              A determined attacker with write access could recompute the whole
              chain. What this makes impossible is a <em>silent</em> edit — and
              in practice that is the difference between an audit log and a
              table of hopes.
            </Callout>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
