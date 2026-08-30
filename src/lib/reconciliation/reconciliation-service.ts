import { prisma } from "../prisma";
import { generateId } from "../ids";
import { mockRazorpay } from "../payments/mock-razorpay";

export type ReconciliationOutcome =
  | "MATCHED"
  | "MISSING_INTERNAL"
  | "MISSING_EXTERNAL"
  | "AMOUNT_MISMATCH"
  | "STATUS_MISMATCH"
  | "DUPLICATE";

export type ReconciliationSeverity = "INFO" | "WARNING" | "CRITICAL";

/**
 * Run reconciliation for a payment intent
 */
export async function reconcilePayment(paymentIntentId: string) {
  const payment = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });

  if (!payment) {
    throw new Error(`Payment intent not found: ${paymentIntentId}`);
  }

  const providerRef = payment.providerPaymentId;
  if (!providerRef) {
    // No provider reference, skip reconciliation
    return null;
  }

  // Get provider status
  const providerStatus = await mockRazorpay.getOperation(providerRef);

  if (!providerStatus) {
    // Provider record missing
    return createReconciliationCase(
      paymentIntentId,
      providerRef,
      "MISSING_EXTERNAL",
      "CRITICAL",
      payment.correlationId,
      payment.amountPaise,
      null
    );
  }

  // Compare amounts
  if (payment.amountPaise !== providerStatus.amountPaise) {
    return createReconciliationCase(
      paymentIntentId,
      providerRef,
      "AMOUNT_MISMATCH",
      "CRITICAL",
      payment.correlationId,
      payment.amountPaise,
      providerStatus.amountPaise
    );
  }

  // Compare statuses
  const internalStatus = payment.status;
  const externalStatus = providerStatus.status;

  if (internalStatus !== externalStatus) {
    // If external is CONFIRMED but internal is UNKNOWN, update internal
    if (externalStatus === "CONFIRMED" && internalStatus === "UNKNOWN") {
      await prisma.paymentIntent.update({
        where: { id: paymentIntentId },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
        },
      });

      return createReconciliationCase(
        paymentIntentId,
        providerRef,
        "MATCHED",
        "INFO",
        payment.correlationId,
        payment.amountPaise,
        providerStatus.amountPaise
      );
    }

    return createReconciliationCase(
      paymentIntentId,
      providerRef,
      "STATUS_MISMATCH",
      "WARNING",
      payment.correlationId,
      payment.amountPaise,
      providerStatus.amountPaise
    );
  }

  // All matched
  return createReconciliationCase(
    paymentIntentId,
    providerRef,
    "MATCHED",
    "INFO",
    payment.correlationId,
    payment.amountPaise,
    providerStatus.amountPaise
  );
}

/**
 * Create or update reconciliation case
 */
async function createReconciliationCase(
  paymentIntentId: string,
  providerReference: string,
  outcome: ReconciliationOutcome,
  severity: ReconciliationSeverity,
  correlationId: string,
  internalAmount: number,
  externalAmount: number | null
) {
  // Check if case already exists
  const existing = await prisma.reconciliationCase.findFirst({
    where: {
      paymentIntentId,
      correlationId,
    },
  });

  const caseId = existing?.id || generateId();

  const data = {
    id: caseId,
    paymentIntentId,
    providerReference,
    outcome,
    severity,
    status: outcome === "MATCHED" ? "RESOLVED" : "OPEN",
    internalAmountPaise: internalAmount,
    externalAmountPaise: externalAmount,
    correlationId,
    ...(outcome === "MATCHED" && { resolvedAt: new Date() }),
  };

  if (existing) {
    await prisma.reconciliationCase.update({
      where: { id: caseId },
      data,
    });
  } else {
    await prisma.reconciliationCase.create({ data });
  }

  return caseId;
}

/**
 * Run full reconciliation across all payments
 */
export async function runFullReconciliation() {
  const payments = await prisma.paymentIntent.findMany({
    where: {
      status: {
        in: ["SUBMITTED", "ACKNOWLEDGED", "UNKNOWN", "CONFIRMED"],
      },
    },
  });

  const results: string[] = [];

  for (const payment of payments) {
    const caseId = await reconcilePayment(payment.id);
    if (caseId) {
      results.push(caseId);
    }
  }

  return results;
}

/**
 * Resolve reconciliation case
 */
export async function resolveReconciliationCase(
  caseId: string,
  resolution: "ACCEPT" | "INVESTIGATE" | "FREEZE",
  notes: string
) {
  const reconciliationCase = await prisma.reconciliationCase.findUnique({
    where: { id: caseId },
  });

  if (!reconciliationCase) {
    throw new Error(`Reconciliation case not found: ${caseId}`);
  }

  const newStatus =
    resolution === "FREEZE"
      ? "FROZEN"
      : resolution === "INVESTIGATE"
        ? "INVESTIGATING"
        : "RESOLVED";

  await prisma.reconciliationCase.update({
    where: { id: caseId },
    data: {
      status: newStatus,
      notes: `${reconciliationCase.notes || ""}\n${new Date().toISOString()}: ${notes}`.trim(),
      resolvedAt: new Date(),
    },
  });
}

/**
 * Get open reconciliation cases
 */
export async function getOpenReconciliationCases() {
  return prisma.reconciliationCase.findMany({
    where: {
      status: {
        in: ["OPEN", "INVESTIGATING"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}
