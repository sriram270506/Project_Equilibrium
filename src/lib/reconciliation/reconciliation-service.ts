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
 * Pure helper: Detect reconciliation issues between internal and external status
 */
export interface ReconciliationIssueDetectionInput {
  internalStatus: string | null;
  externalStatus: string | null;
  internalAmountPaise: number | null;
  externalAmountPaise: number | null;
}

export interface ReconciliationIssueResult {
  outcome: ReconciliationOutcome;
  issue: string | null;
  canResolveAutomatically?: boolean;
}

export function detectReconciliationIssue(
  input: ReconciliationIssueDetectionInput
): ReconciliationIssueResult {
  const {
    internalStatus,
    externalStatus,
    internalAmountPaise,
    externalAmountPaise,
  } = input;

  // Check for missing records
  if (!internalStatus && !externalStatus) {
    return {
      outcome: "MISSING_INTERNAL",
      issue: "Both internal and external records missing",
    };
  }

  if (!internalStatus) {
    return {
      outcome: "MISSING_INTERNAL",
      issue: "Internal record missing",
    };
  }

  if (!externalStatus) {
    return {
      outcome: "MISSING_EXTERNAL",
      issue: "External record missing",
    };
  }

  // Amount mismatch takes priority
  if (internalAmountPaise !== externalAmountPaise) {
    return {
      outcome: "AMOUNT_MISMATCH",
      issue: `amount mismatch: internal Rs${(internalAmountPaise || 0) / 100}, external Rs${(externalAmountPaise || 0) / 100}`,
    };
  }

  // Status mismatch
  if (internalStatus !== externalStatus) {
    // Check if it's an UNKNOWN → CONFIRMED resolution
    const canResolveAutomatically =
      internalStatus === "UNKNOWN" && externalStatus === "CONFIRMED";

    return {
      outcome: "STATUS_MISMATCH",
      issue: `status mismatch: internal ${internalStatus}, external ${externalStatus}`,
      canResolveAutomatically,
    };
  }

  // All matched
  return {
    outcome: "MATCHED",
    issue: null,
  };
}

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

  // Use pure detection function
  const detection = detectReconciliationIssue({
    internalStatus: payment.status,
    externalStatus: providerStatus?.status ?? null,
    internalAmountPaise: payment.amountPaise,
    externalAmountPaise: providerStatus?.amountPaise ?? null,
  });

  // Map detection result to severity
  const severityMap: Record<ReconciliationOutcome, ReconciliationSeverity> = {
    MATCHED: "INFO",
    MISSING_INTERNAL: "CRITICAL",
    MISSING_EXTERNAL: "CRITICAL",
    AMOUNT_MISMATCH: "CRITICAL",
    STATUS_MISMATCH: "WARNING",
    DUPLICATE: "WARNING",
  };

  const severity = severityMap[detection.outcome];

  // If UNKNOWN → CONFIRMED, auto-resolve
  if (
    detection.outcome === "STATUS_MISMATCH" &&
    detection.canResolveAutomatically
  ) {
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
      providerStatus?.amountPaise || payment.amountPaise
    );
  }

  return createReconciliationCase(
    paymentIntentId,
    providerRef,
    detection.outcome,
    severity,
    payment.correlationId,
    payment.amountPaise,
    providerStatus?.amountPaise || null
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
 * Run full reconciliation across all payments for a tenant
 */
export async function runFullReconciliation(tenantId?: string) {
  const payments = await prisma.paymentIntent.findMany({
    where: {
      ...(tenantId && { tenantId }),
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
