import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { formatPaise } from "@/src/lib/money";

/**
 * GET /api/events/stream?since=<sequence>
 *
 * The audit chain, as an operator-readable activity feed.
 *
 * Backend work is invisible by default: a payment submits, a webhook lands, a
 * reconciliation case opens, and none of it appears anywhere until someone
 * navigates to the right page. This turns the hash-chained audit log — which
 * already records every state change — into something a person can watch.
 *
 * Polls rather than server-sent events. A demo running on SQLite has no
 * business holding open connections, and `since` makes polling cheap: the
 * client passes the highest sequence it has seen and gets only what is new.
 */

/** How each event type should read, and how much attention it deserves. */
const EVENT_PRESENTATION: Record<
  string,
  { label: string; tone: "ok" | "warn" | "danger" | "info" | "brand" }
> = {
  OPPORTUNITY_EVALUATED: { label: "Model scored a supplier", tone: "info" },
  OPPORTUNITY_APPROVED: { label: "Operator approved an offer", tone: "brand" },
  SECOND_APPROVAL_GRANTED: {
    label: "Second operator confirmed",
    tone: "brand",
  },
  PAYMENT_SUBMITTED: { label: "Instruction sent to provider", tone: "info" },
  PAYMENT_CONFIRMED: { label: "Provider confirmed the payment", tone: "ok" },
  PAYMENT_UNKNOWN: {
    label: "Provider call timed out — outcome unknown",
    tone: "warn",
  },
  PAYMENT_FAILED: { label: "Provider declined", tone: "danger" },
  PAYMENT_REVERSED: { label: "Payment reversed", tone: "danger" },
  WEBHOOK_RECEIVED: { label: "Webhook received", tone: "info" },
  RECONCILIATION_RESOLVED: { label: "Exception resolved", tone: "ok" },
  KILL_SWITCH_ENGAGED: { label: "Kill switch engaged", tone: "danger" },
  KILL_SWITCH_RELEASED: { label: "Kill switch released", tone: "ok" },
  RISK_LIMITS_UPDATED: { label: "Risk limits changed", tone: "warn" },
  INVOICE_ANOMALY_OPENED: { label: "Invoice anomaly raised", tone: "warn" },
  CONTROLLER_TOOL_CALL: { label: "Controller read evidence", tone: "info" },
  OUTBOX_EVENT_REPLAYED: { label: "Dead-lettered event replayed", tone: "warn" },
};

export const GET = withAuth(
  "VIEWER",
  async (request: NextRequest, _context: unknown, auth) => {
    try {
      const url = new URL(request.url);
      const since = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 40), 100);

      const events = await prisma.auditEvent.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(Number.isFinite(since) && since > 0
            ? { sequence: { gt: since } }
            : {}),
        },
        orderBy: { sequence: "desc" },
        take: limit,
        include: { supplier: { select: { name: true } } },
      });

      const highestSequence = await prisma.auditEvent.findFirst({
        where: { tenantId: auth.tenantId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });

      return NextResponse.json(
        successEnvelope({
          // Oldest first, so a client appending to a list reads chronologically.
          events: events.reverse().map((e) => {
            const payload = JSON.parse(e.payloadJson) as Record<string, unknown>;
            const presentation = EVENT_PRESENTATION[e.eventType] ?? {
              label: e.eventType.replace(/_/g, " ").toLowerCase(),
              tone: "info" as const,
            };

            // Surface an amount when the payload carries one, so the feed shows
            // money moving rather than only that something happened.
            const amountPaise =
              typeof payload.amount_paise === "number"
                ? payload.amount_paise
                : null;

            return {
              sequence: e.sequence,
              eventType: e.eventType,
              label: presentation.label,
              tone: presentation.tone,
              actorType: e.actorType,
              actorId: e.actorId,
              aggregateType: e.aggregateType,
              aggregateId: e.aggregateId,
              supplierName: e.supplier?.name ?? null,
              amountPaise,
              amountDisplay: amountPaise !== null ? formatPaise(amountPaise) : null,
              correlationId: e.correlationId,
              createdAt: e.createdAt,
              entryHash: e.entryHash,
            };
          }),
          highestSequence: highestSequence?.sequence ?? 0,
        })
      );
    } catch (error) {
      console.error("Error reading the event stream:", error);
      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to read the event stream"),
        { status: 500 }
      );
    }
  }
);
