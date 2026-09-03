import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { appendEvent } from "@/src/lib/events/event-service";
import { createAuditEvent } from "@/src/lib/audit";
import { assertPaymentTransition, PaymentStatus } from "@/src/lib/state-machine";
import {
  authenticateWebhook,
  checkTimestamp,
  normaliseWebhook,
  razorpayWebhookSchema,
  isMockMode,
} from "@/src/lib/payments/webhook-security";
import { logger, correlationIdFrom } from "@/src/lib/observability/logger";
import { metrics } from "@/src/lib/observability/metrics";
import { withRateLimit, extractIdentifier } from "@/src/lib/api/rate-limit-middleware";
import { withErrorHandler } from "@/src/lib/api/error-handler";

/**
 * POST /api/webhooks/razorpay
 *
 * Order of operations, and why each step precedes the next:
 *
 *   1. Rate limit by provider signature/IP
 *   2. Read the RAW body. Never parse first — the signature covers exact bytes,
 *      and re-serialising JSON changes them.
 *   3. Authenticate: configuration, then signature. Fails closed outside mock.
 *   4. Validate with Zod. A malformed payload is rejected before any write.
 *   5. Reject replays outside the timestamp window.
 *   6. Deduplicate on the provider's event id.
 *   7. Only then mutate, inside one transaction.
 *
 * Everything before step 7 is a rejection path that writes nothing.
 */
const webhookHandler = async (request: NextRequest) => {
  const correlationId = correlationIdFrom(request);
  const log = logger.child({ correlationId, route: "webhooks/razorpay" });
  const started = Date.now();

  try {
    /* 1. Raw body ------------------------------------------------------- */
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");

    /* 2. Authenticate --------------------------------------------------- */
    const auth = authenticateWebhook(rawBody, signature);
    if (!auth.accepted) {
      metrics.increment("webhook.rejected", { reason: auth.reason ?? "unknown" });
      log.warn("webhook.rejected", { reason: auth.reason, detail: auth.detail });
      return NextResponse.json(
        errorEnvelope(auth.reason ?? "REJECTED", auth.detail ?? "Rejected."),
        { status: auth.status ?? 401 }
      );
    }

    /* 3. Validate ------------------------------------------------------- */
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      metrics.increment("webhook.rejected", { reason: "MALFORMED_PAYLOAD" });
      log.warn("webhook.rejected", { reason: "MALFORMED_PAYLOAD" });
      return NextResponse.json(
        errorEnvelope("MALFORMED_PAYLOAD", "Body is not valid JSON."),
        { status: 400 }
      );
    }

    const parsed = razorpayWebhookSchema.safeParse(json);
    if (!parsed.success) {
      metrics.increment("webhook.rejected", { reason: "SCHEMA_INVALID" });
      log.warn("webhook.rejected", {
        reason: "SCHEMA_INVALID",
        issueCount: parsed.error.issues.length,
      });
      return NextResponse.json(
        errorEnvelope("SCHEMA_INVALID", "Webhook payload failed validation.", {
          issues: parsed.error.issues,
        }),
        { status: 400 }
      );
    }

    const event = normaliseWebhook(parsed.data);
    if (!event) {
      metrics.increment("webhook.rejected", { reason: "INCOMPLETE_PAYLOAD" });
      log.warn("webhook.rejected", { reason: "INCOMPLETE_PAYLOAD" });
      return NextResponse.json(
        errorEnvelope(
          "INCOMPLETE_PAYLOAD",
          "Webhook is missing an event id, event type, payment id, or status."
        ),
        { status: 400 }
      );
    }

    /* 4. Replay window -------------------------------------------------- */
    // Our own mock emits events without a provider timestamp; a real provider
    // always sends one, and outside mock mode we require it.
    if (!isMockMode() || event.timestampSeconds !== undefined) {
      const freshness = checkTimestamp(event.timestampSeconds);
      if (!freshness.accepted) {
        metrics.increment("webhook.rejected", {
          reason: freshness.reason ?? "STALE",
        });
        log.warn("webhook.rejected", {
          reason: freshness.reason,
          detail: freshness.detail,
          eventId: event.eventId,
        });
        return NextResponse.json(
          errorEnvelope(
            freshness.reason ?? "STALE_TIMESTAMP",
            freshness.detail ?? "Outside the replay window."
          ),
          { status: freshness.status ?? 400 }
        );
      }
    }

    /* 5. Deduplicate ---------------------------------------------------- */
    const alreadySeen = await prisma.eventRecord.findFirst({
      where: { idempotencyKey: event.eventId },
      select: { id: true },
    });

    if (alreadySeen) {
      metrics.increment("webhook.duplicate");
      log.info("webhook.duplicate", { eventId: event.eventId });
      // 200 so the provider stops retrying. Nothing changed.
      return NextResponse.json(
        successEnvelope({ received: true, duplicate: true, applied: false })
      );
    }

    /* 6. Apply ---------------------------------------------------------- */
    const payment = await prisma.paymentIntent.findFirst({
      where: { providerPaymentId: event.providerPaymentId },
    });

    if (!payment) {
      // An event for something we have no record of is a reconciliation
      // finding, not an error. Record it so it cannot be lost.
      metrics.increment("webhook.orphan");
      log.warn("webhook.orphan", {
        eventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
      });
      await appendEvent(
        "PAYMENT_INTENT",
        event.providerPaymentId,
        event.eventType,
        parsed.data as Record<string, unknown>,
        correlationId,
        event.eventId
      );
      return NextResponse.json(
        successEnvelope({ received: true, orphan: true, applied: false })
      );
    }

    const scopedLog = log.child({
      paymentIntentId: payment.id,
      providerPaymentId: event.providerPaymentId,
      eventId: event.eventId,
    });

    /*
     * An amount that disagrees with our record is NEVER applied.
     *
     * The provider is authoritative about whether money moved, but a
     * disagreement about how much is a critical finding that a human must
     * resolve. Silently adopting the provider's number would hide the very
     * error reconciliation exists to surface.
     */
    if (
      event.amountPaise !== undefined &&
      event.amountPaise !== payment.amountPaise
    ) {
      metrics.increment("webhook.amount_mismatch");
      scopedLog.error("webhook.amount_mismatch", {
        ourAmountPaise: payment.amountPaise,
        theirAmountPaise: event.amountPaise,
      });

      await prisma.reconciliationCase.create({
        data: {
          id: `rec_wh_${event.eventId}`.slice(0, 60),
          paymentIntentId: payment.id,
          providerReference: event.providerPaymentId,
          outcome: "AMOUNT_MISMATCH",
          severity: "CRITICAL",
          status: "OPEN",
          internalAmountPaise: payment.amountPaise,
          externalAmountPaise: event.amountPaise,
          correlationId: payment.correlationId,
          notes: `Webhook ${event.eventId} reported ${event.amountPaise} paise against our ${payment.amountPaise}. Not applied.`,
        },
      });

      return NextResponse.json(
        successEnvelope({
          received: true,
          applied: false,
          reason: "Amount mismatch raised as a critical exception.",
        })
      );
    }

    const nextStatus = mapProviderStatus(event.status);

    // Illegal transitions are refused, not forced.
    let transitionAllowed = true;
    if (nextStatus && nextStatus !== payment.status) {
      try {
        assertPaymentTransition(
          payment.status as PaymentStatus,
          nextStatus as PaymentStatus
        );
      } catch {
        transitionAllowed = false;
        metrics.increment("webhook.transition_refused");
        scopedLog.warn("webhook.transition_refused", {
          from: payment.status,
          to: nextStatus,
        });
      }
    }

    /*
     * One transaction covering the event record, the state change and the
     * audit entry.
     *
     * EventRecord.idempotencyKey is UNIQUE at the database level, which is what
     * makes concurrent duplicate deliveries safe: the second insert violates
     * the constraint and rolls the whole transaction back rather than applying
     * a second state change or a second ledger posting. The check in step 5 is
     * an optimisation; this constraint is the actual guarantee.
     */
    const lastEvent = await prisma.eventRecord.findFirst({
      where: { aggregateType: "PAYMENT_INTENT", aggregateId: payment.id },
      orderBy: { sequenceNumber: "desc" },
      select: { sequenceNumber: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.eventRecord.create({
        data: {
          id: `evt_${event.eventId}`.slice(0, 60),
          eventType: event.eventType,
          aggregateType: "PAYMENT_INTENT",
          aggregateId: payment.id,
          sequenceNumber: (lastEvent?.sequenceNumber ?? 0) + 1,
          schemaVersion: "1.0",
          payloadJson: JSON.stringify(parsed.data),
          source: "PROVIDER",
          idempotencyKey: event.eventId,
          correlationId: payment.correlationId,
          paymentIntentId: payment.id,
        },
      });

      if (nextStatus && nextStatus !== payment.status && transitionAllowed) {
        await tx.paymentIntent.update({
          where: { id: payment.id },
          data: {
            status: nextStatus,
            confirmedAt: nextStatus === "CONFIRMED" ? new Date() : undefined,
          },
        });
      }

      await createAuditEvent(
        {
          eventType: "WEBHOOK_RECEIVED",
          actorType: "PROVIDER",
          actorId: "razorpay-webhook",
          aggregateType: "PAYMENT_INTENT",
          aggregateId: payment.id,
          payload: {
            provider_event_id: event.eventId,
            provider_event_type: event.eventType,
            provider_status: event.status,
            applied_status: transitionAllowed ? nextStatus : null,
            transition_refused: !transitionAllowed,
          },
          correlationId: payment.correlationId,
          supplierId: payment.supplierId,
        },
        tx
      );
    });

    metrics.increment("webhook.applied");
    metrics.observe("webhook.duration_ms", Date.now() - started);
    scopedLog.info("webhook.applied", {
      status: transitionAllowed ? nextStatus : payment.status,
      transitionRefused: !transitionAllowed,
      durationMs: Date.now() - started,
    });

    return NextResponse.json(
      successEnvelope({
        received: true,
        applied: transitionAllowed,
        status: transitionAllowed ? nextStatus : payment.status,
      })
    );
  } catch (error) {
    metrics.increment("webhook.error");
    log.error("webhook.error", { error: (error as Error).message });
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to process the webhook."),
      { status: 500 }
    );
  }
};

export const POST = withErrorHandler(
  withRateLimit("webhook", webhookHandler, {
    getIdentifier: (req) => extractIdentifier(req, "webhook"),
  })
);

/** Razorpay payment and payout states, mapped onto ours. */
function mapProviderStatus(status: string): string | null {
  switch (status.toLowerCase()) {
    case "captured":
    case "paid":
    case "processed":
    case "confirmed":
      return "CONFIRMED";
    case "failed":
    case "rejected":
    case "cancelled":
      return "FAILED";
    case "reversed":
      return "REVERSED";
    case "processing":
      return "ACKNOWLEDGED";
    case "created":
    case "queued":
    case "pending":
      return "SUBMITTED";
    default:
      return null;
  }
}

/** Health probe reporting the receiver's actual security posture. */
export async function GET() {
  const hasSecret = Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
  const mock = isMockMode();

  return NextResponse.json(
    successEnvelope({
      message: "Razorpay webhook receiver",
      mode: mock ? "mock" : "live",
      signatureVerification: hasSecret
        ? "enforced"
        : mock
          ? "disabled (mock mode only)"
          : "MISCONFIGURED - a secret is required outside mock mode; all webhooks are rejected",
      replayWindowHours: 24,
      healthy: hasSecret || mock,
    })
  );
}
