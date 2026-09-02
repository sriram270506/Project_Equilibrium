import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { appendEvent } from "@/src/lib/events/event-service";

interface RazorpayWebhookPayload {
  eventId: string;
  eventType: string;
  paymentId: string;
  orderId?: string;
  status: string;
  amount: number;
  currency: string;
  timestamp: string;
  signature?: string;
  [key: string]: unknown;
}

/**
 * Verify Razorpay webhook signature
 * Computes HMAC-SHA256(body, secret) and compares with signature header
 */
function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // In demo mode with empty secret, accept all webhooks
  if (!secret || secret.length === 0) {
    console.log("⚠️  RAZORPAY_WEBHOOK_SECRET not set - accepting all webhooks (demo mode)");
    return true;
  }

  if (!signature) {
    console.warn("❌ Webhook signature missing");
    return false;
  }

  try {
    // Compute expected signature
    const computed = createHmac("sha256", secret)
      .update(rawBody, "utf-8")
      .digest("hex");

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, "hex");
    const computedBuffer = Buffer.from(computed, "hex");

    if (signatureBuffer.length !== computedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, computedBuffer);
  } catch (error) {
    console.error("Error verifying webhook signature:", error);
    return false;
  }
}

/**
 * Process Razorpay webhook
 * POST /api/webhooks/razorpay
 */
export async function POST(request: NextRequest) {
  try {
    // Get signature header
    const signature = request.headers.get("x-razorpay-signature");

    // Read raw body for signature verification
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch (error) {
      console.error("Failed to read request body:", error);
      return NextResponse.json(
        errorEnvelope("INVALID_REQUEST", "Failed to read request body"),
        { status: 400 }
      );
    }

    // Verify signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn("❌ Invalid webhook signature");
      return NextResponse.json(
        errorEnvelope("INVALID_SIGNATURE", "Webhook signature verification failed"),
        { status: 400 }
      );
    }

    // Parse payload
    let payload: RazorpayWebhookPayload;
    try {
      if (!rawBody || rawBody.trim().length === 0) {
        throw new Error("Empty request body");
      }
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error("Failed to parse webhook payload:", error, "body:", rawBody);
      return NextResponse.json(
        errorEnvelope("INVALID_PAYLOAD", "Failed to parse webhook"),
        { status: 400 }
      );
    }

    // Deduplicate on idempotency key (eventId)
    const idempotencyKey = payload.eventId;

    const existingEvent = await prisma.eventRecord.findFirst({
      where: {
        idempotencyKey,
      },
    });

    if (existingEvent) {
      // Duplicate webhook - return success (idempotent)
      console.log(`📩 Duplicate webhook ${payload.eventId} - returning success`);
      return NextResponse.json(successEnvelope({ received: true }));
    }

    // Find the payment intent by provider payment ID
    const paymentIntent = await prisma.paymentIntent.findFirst({
      where: {
        providerPaymentId: payload.paymentId,
      },
    });

    if (!paymentIntent) {
      console.warn(
        `⚠️  Webhook for unknown payment ${payload.paymentId} - creating orphan event`
      );
      // Still publish the event for audit trail
      await appendEvent(
        "PAYMENT",
        payload.paymentId,
        payload.eventType,
        payload,
        payload.eventId || ""
      );
      return NextResponse.json(successEnvelope({ received: true }));
    }

    // Update payment intent status based on webhook
    let internalStatus = "UNKNOWN";
    switch (payload.status) {
      case "CONFIRMED":
      case "succeeded":
        internalStatus = "CONFIRMED";
        break;
      case "FAILED":
      case "failed":
        internalStatus = "FAILED";
        break;
      case "PENDING":
      case "pending":
        internalStatus = "SUBMITTED";
        break;
      default:
        internalStatus = "UNKNOWN";
    }

    // Update payment intent
    await prisma.paymentIntent.update({
      where: { id: paymentIntent.id },
      data: {
        status: internalStatus,
        confirmedAt:
          internalStatus === "CONFIRMED" ? new Date() : undefined,
        updatedAt: new Date(),
      },
    });

    // Publish event to event stream
    await appendEvent(
      "PAYMENT",
      paymentIntent.id,
      payload.eventType,
      payload,
      paymentIntent.correlationId
    );

    // Create audit event
    await prisma.auditEvent.create({
      data: {
        id: `audit_${Date.now()}`,
        actorId: "webhook",
        actorType: "PROVIDER_WEBHOOK",
        action: "WEBHOOK_RECEIVED",
        aggregateType: "PAYMENT",
        aggregateId: paymentIntent.id,
        resourceType: "PaymentIntent",
        resourceId: paymentIntent.id,
        changes: JSON.stringify({
          status: internalStatus,
          providerEventId: payload.eventId,
        }),
        correlationId: paymentIntent.correlationId,
        supplierId: paymentIntent.supplierId,
        createdAt: new Date(),
      },
    });

    console.log(
      `✅ Webhook ${payload.eventId} processed for payment ${paymentIntent.id}`
    );

    return NextResponse.json(successEnvelope({ received: true }));
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to process webhook"),
      { status: 500 }
    );
  }
}

/**
 * GET /api/webhooks/razorpay - health check
 */
export async function GET() {
  return NextResponse.json(
    successEnvelope({
      message: "Razorpay webhook receiver is healthy",
      usage: "POST with Razorpay event payload and x-razorpay-signature header",
      signatureVerification: process.env.RAZORPAY_WEBHOOK_SECRET
        ? "enabled"
        : "disabled (demo mode)",
    })
  );
}
