import { prisma } from "../prisma";
import { mockRazorpay } from "./mock-razorpay";
import { CreateOperationInput } from "./provider-types";
import { createAuditEvent } from "../audit";

/**
 * Pure helper: Determine payment status from provider result
 */
export interface DeterminePaymentStatusInput {
  providerResult: {
    status: string;
    providerPaymentId?: string;
    reason?: string;
  } | null;
  operationTimeoutMs: number;
}

export function determinePaymentStatus(
  input: DeterminePaymentStatusInput
): string {
  const { providerResult, operationTimeoutMs } = input;

  // Provider gave us a result
  if (providerResult) {
    return providerResult.status;
  }

  // No result - check timeout
  if (operationTimeoutMs > 0) {
    return "UNKNOWN";
  }

  // No timeout, no result = still processing
  return "SUBMITTED";
}

/**
 * Pure helper: Check if a payment status is terminal (no further changes expected)
 */
export function isTerminalStatus(status: string): boolean {
  const TERMINAL_STATUSES = ["CONFIRMED", "FAILED", "REVERSED", "MANUAL_REVIEW"];
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Submit payment intent to provider
 */
export async function submitPaymentToProvider(
  paymentIntentId: string
): Promise<string> {
  const payment = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });

  if (!payment) {
    throw new Error(`Payment intent not found: ${paymentIntentId}`);
  }

  if (payment.status !== "INTENT_CREATED") {
    throw new Error(
      `Cannot submit payment with status: ${payment.status}`
    );
  }

  // Create provider operation input
  const operationInput: CreateOperationInput = {
    providerIdempotencyKey: payment.providerIdempotencyKey,
    requestFingerprint: payment.requestFingerprint,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    operationType: payment.operationType,
    recipientId: payment.supplierId,
  };

  // Submit to provider
  const providerResult = await mockRazorpay.createOperation(operationInput);

  // Update payment intent
  let newStatus = "SUBMITTED";
  if (providerResult.status === "CONFIRMED") {
    newStatus = "CONFIRMED";
  } else if (providerResult.status === "FAILED") {
    newStatus = "FAILED";
  } else if (
    providerResult.status === "UNKNOWN" ||
    providerResult.failureMode === "timeout_after_remote_success"
  ) {
    newStatus = "UNKNOWN";
  }

  await prisma.paymentIntent.update({
    where: { id: paymentIntentId },
    data: {
      status: newStatus,
      providerPaymentId: providerResult.providerPaymentId,
      providerOrderId: providerResult.providerOrderId,
      failureMode: providerResult.failureMode,
      confirmedAt: newStatus === "CONFIRMED" ? new Date() : null,
    },
  });

  // Audit
  await createAuditEvent({
    eventType: "PAYMENT_SUBMITTED",
    actorType: "SYSTEM",
    actorId: "payment-service",
    aggregateType: "PAYMENT_INTENT",
    aggregateId: paymentIntentId,
    payload: {
      provider_status: providerResult.status,
      provider_payment_id: providerResult.providerPaymentId,
    },
    correlationId: payment.correlationId,
  });

  return newStatus;
}

/**
 * Get payment intent details with timeline
 */
export async function getPaymentDetails(paymentIntentId: string) {
  const payment = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
    include: {
      supplier: true,
      ledgerTransactions: {
        include: {
          entries: true,
        },
      },
    },
  });

  if (!payment) {
    return null;
  }

  // Get audit trail
  const auditEvents = await prisma.auditEvent.findMany({
    where: {
      aggregateId: paymentIntentId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return {
    id: payment.id,
    internalReference: payment.internalReference,
    supplierId: payment.supplierId,
    supplier: payment.supplier,
    amount: payment.amountPaise,
    currency: payment.currency,
    status: payment.status,
    operationType: payment.operationType,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    providerOrderId: payment.providerOrderId,
    correlationId: payment.correlationId,
    failureMode: payment.failureMode,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    confirmedAt: payment.confirmedAt,
    ledger: payment.ledgerTransactions,
    timeline: auditEvents.map((event) => ({
      timestamp: event.createdAt,
      eventType: event.eventType,
      actor: event.actorId,
      details: JSON.parse(event.payloadJson),
    })),
  };
}

/**
 * Simulate webhook for payment
 */
export async function simulateWebhook(paymentIntentId: string) {
  const payment = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });

  if (!payment || !payment.providerPaymentId) {
    throw new Error(`Invalid payment for webhook: ${paymentIntentId}`);
  }

  const webhook = await mockRazorpay.simulateWebhook(
    payment.providerPaymentId
  );

  if (!webhook) {
    throw new Error("Failed to generate webhook");
  }

  // Process webhook (in real app, this would come from provider)
  if (webhook.status === "payment.confirmed") {
    await prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });
  }

  return webhook;
}
