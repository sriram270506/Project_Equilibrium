import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { metrics } from "@/src/lib/observability/metrics";
import { selectProvider } from "@/src/lib/payments/provider";
import { isMockMode } from "@/src/lib/payments/webhook-security";
import { verifyAuditChain } from "@/src/lib/audit";
import { calculateTrialBalance } from "@/src/lib/ledger/trial-balance";

/**
 * GET /api/health
 *
 * Health and operational metrics in one place, so an operator can answer "is
 * the system degraded, and how?" without reading server logs.
 *
 * `degraded` is deliberately distinct from `down`. A misconfigured webhook
 * secret or an out-of-balance ledger does not stop the process from serving
 * requests, but it absolutely means the system should not be trusted with
 * money — and a health check that reports "ok" in that state is worse than
 * none at all.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  /* Database ---------------------------------------------------------- */
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = {
      ok: true,
      detail: `Responded in ${Date.now() - dbStart}ms`,
    };
  } catch (error) {
    checks.database = { ok: false, detail: (error as Error).message };
  }

  /* Provider configuration -------------------------------------------- */
  const provider = selectProvider();
  checks.provider = {
    ok: true,
    detail: provider.isLive
      ? provider.description
      : `${provider.description} — ${provider.fallbackReason ?? ""}`,
  };

  /* Webhook posture ---------------------------------------------------- */
  const hasWebhookSecret = Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
  checks.webhooks = {
    ok: hasWebhookSecret || isMockMode(),
    detail: hasWebhookSecret
      ? "Signature verification enforced"
      : isMockMode()
        ? "Unsigned webhooks accepted (mock mode only)"
        : "MISCONFIGURED: no secret outside mock mode, every webhook will be rejected",
  };

  /* Financial integrity ------------------------------------------------ */
  try {
    const trialBalance = await calculateTrialBalance();
    checks.ledger = {
      ok: trialBalance.balanced,
      detail: trialBalance.balanced
        ? `Balanced across ${trialBalance.accounts.length} accounts`
        : `OUT OF BALANCE by ${trialBalance.net} paise`,
    };
  } catch (error) {
    checks.ledger = { ok: false, detail: (error as Error).message };
  }

  try {
    const chain = await verifyAuditChain();
    checks.auditChain = {
      ok: chain.valid,
      detail: chain.valid
        ? `Verified across ${chain.entriesChecked} entries`
        : `BROKEN at entry ${chain.firstBreak?.sequence}: ${chain.firstBreak?.reason}`,
    };
  } catch (error) {
    checks.auditChain = { ok: false, detail: (error as Error).message };
  }

  /* Work backlog ------------------------------------------------------- */
  try {
    const [pendingOutbox, failedOutbox, openCritical, pendingApproval, unknown] =
      await Promise.all([
        prisma.outboxEvent.count({ where: { status: "PENDING" } }),
        prisma.outboxEvent.count({ where: { status: "FAILED" } }),
        prisma.reconciliationCase.count({
          where: {
            severity: "CRITICAL",
            status: { in: ["OPEN", "INVESTIGATING"] },
          },
        }),
        prisma.paymentIntent.count({ where: { status: "PENDING_APPROVAL" } }),
        prisma.paymentIntent.count({ where: { status: "UNKNOWN" } }),
      ]);

    checks.backlog = {
      ok: failedOutbox === 0 && openCritical === 0,
      detail:
        failedOutbox > 0 || openCritical > 0
          ? `${failedOutbox} dead-lettered events, ${openCritical} critical exceptions open`
          : "No dead-lettered events or critical exceptions",
    };

    const failing = Object.entries(checks).filter(([, c]) => !c.ok);

    return NextResponse.json(
      successEnvelope({
        status:
          failing.length === 0
            ? "operational"
            : checks.database.ok
              ? "degraded"
              : "down",
        degradedReasons: failing.map(([name, c]) => `${name}: ${c.detail}`),
        checks,
        work: {
          pendingOutboxEvents: pendingOutbox,
          deadLetteredEvents: failedOutbox,
          openCriticalExceptions: openCritical,
          paymentsAwaitingApproval: pendingApproval,
          paymentsInUnknownState: unknown,
        },
        metrics: metrics.snapshot(),
        mode: process.env.APP_MODE ?? "demo",
        timestamp: new Date().toISOString(),
      }),
      { status: failing.length === 0 ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json(
      errorEnvelope("HEALTH_CHECK_FAILED", (error as Error).message),
      { status: 503 }
    );
  }
}
