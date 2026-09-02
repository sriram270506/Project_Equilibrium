import { prisma } from "../prisma";
import { mockRazorpay } from "./mock-razorpay";
import { CreateOperationInput } from "./provider-types";
import { createAuditEvent } from "../audit";
import { assertPaymentTransition, PaymentStatus } from "../state-machine";

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

  /*
   * Record that we are about to send, BEFORE we send.
   *
   * If the process dies during the provider call, the payment is left in
   * SUBMITTED - a state reconciliation actively sweeps. Marking it only after
   * the call returns would leave a crashed payment sitting in INTENT_CREATED
   * with money possibly already gone and nothing to alert on. Writing the
   * intent to send first is what makes the crash recoverable.
   */
  assertPaymentTransition(
    payment.status as PaymentStatus,
    "SUBMITTED" as PaymentStatus
  );

  await prisma.paymentIntent.update({
    where: { id: paymentIntentId },
    data: { status: "SUBMITTED" },
  });

  await createAuditEvent({
    eventType: "PAYMENT_SUBMITTED",
    actorType: "SYSTEM",
    actorId: "payment-service",
    aggregateType: "PAYMENT_INTENT",
    aggregateId: paymentIntentId,
    payload: {
      provider: payment.provider,
      idempotency_key: payment.providerIdempotencyKey,
      amount_paise: payment.amountPaise,
    },
    correlationId: payment.correlationId,
  });

  // Now make the call we may not survive.
  const providerResult = await mockRazorpay.createOperation(operationInput);

  /*
   * Map the provider's answer onto our own vocabulary.
   *
   * Timeouts are checked FIRST, before any success status. If the call timed
   * out we did not receive an answer, and it does not matter what the
   * provider's internal record happens to say - we cannot see it. Recording
   * CONFIRMED because the provider "really did" succeed would mean trusting
   * information we never actually received, and would skip the reconciliation
   * that is supposed to establish the truth.
   */
  const timedOut =
    providerResult.failureMode === "timeout_after_remote_success" ||
    providerResult.failureMode === "timeout_before_processing";

  let newStatus: string;
  if (timedOut || providerResult.status === "UNKNOWN") {
    newStatus = "UNKNOWN";
  } else if (providerResult.status === "CONFIRMED") {
    newStatus = "CONFIRMED";
  } else if (providerResult.status === "FAILED") {
    newStatus = "FAILED";
  } else {
    newStatus = "SUBMITTED";
  }

  assertPaymentTransition("SUBMITTED" as PaymentStatus, newStatus as PaymentStatus);

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

  await createAuditEvent({
    eventType: `PAYMENT_${newStatus}`,
    actorType: "PROVIDER",
    actorId: mockRazorpay.getProviderName(),
    aggregateType: "PAYMENT_INTENT",
    aggregateId: paymentIntentId,
    payload: {
      provider_status: providerResult.status,
      provider_payment_id: providerResult.providerPaymentId,
      failure_mode: providerResult.failureMode ?? null,
      failure_reason: providerResult.failureReason ?? null,
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
    // Validate state transition
    assertPaymentTransition(
      payment.status as any,
      "CONFIRMED"
    );
    
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
