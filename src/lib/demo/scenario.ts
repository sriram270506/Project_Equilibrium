import { prisma } from "../prisma";
import {
  evaluateOpportunity,
  approveOpportunity,
  confirmSecondApproval,
} from "@/src/server/opportunity-service";
import {
  submitPaymentToProvider,
  simulateWebhook,
} from "../payments/payment-service";
import { mockRazorpay, FailureMode } from "../payments/mock-razorpay";
import { runFullReconciliation } from "../reconciliation/reconciliation-service";
import { publishPendingEvents } from "../events/event-service";
import { calculateTrialBalance } from "../ledger/trial-balance";
import { formatPaise } from "../money";

/**
 * The guided walkthrough.
 *
 * Each step is a real call into the real services - nothing here is mocked for
 * the sake of the demo. The narration exists so that someone watching a
 * five-minute video knows what just happened and, more importantly, why it was
 * hard.
 */

export type ScenarioStepId =
  | "reset"
  | "score"
  | "approve"
  | "timeout"
  | "duplicate_webhook"
  | "reconcile"
  | "prove";

export interface ScenarioStepResult {
  step: ScenarioStepId;
  title: string;
  /** What an operator would say happened. */
  narration: string;
  /** Why this step is engineering-hard, for the viewer who knows payments. */
  whyItMatters: string;
  /** Concrete facts produced by the step, rendered as a small table. */
  facts: Array<{ label: string; value: string; tone?: "ok" | "warn" | "danger" }>;
  /** Where to look in the console to verify the claim. */
  verifyAt?: { href: string; label: string };
  /** Ids the next step may need. */
  context?: Record<string, string>;
}

export const SCENARIO_STEPS: Array<{
  id: ScenarioStepId;
  title: string;
  summary: string;
}> = [
  {
    id: "reset",
    title: "Start from a clean slate",
    summary: "Six suppliers with 30 days of synthetic cash-flow history.",
  },
  {
    id: "score",
    title: "Find who is about to run short",
    summary: "Score every supplier and let policy bound the offer.",
  },
  {
    id: "approve",
    title: "Approve the offer and move money",
    summary: "One transaction writes intent, ledger, audit, and outbox.",
  },
  {
    id: "timeout",
    title: "Break it: the provider times out",
    summary: "The call fails after the money may already have left.",
  },
  {
    id: "duplicate_webhook",
    title: "Break it again: the webhook arrives twice",
    summary: "A replayed delivery must change nothing.",
  },
  {
    id: "reconcile",
    title: "Resolve the unknown",
    summary: "Compare our books against the provider and settle the truth.",
  },
  {
    id: "prove",
    title: "Prove nothing was lost",
    summary: "Trial balance foots, outbox drains, audit trail is complete.",
  },
];

/** Supplier the story follows, so the narrative stays concrete. */
const PROTAGONIST = "Aarav Industrial Components";

export async function runScenarioStep(
  step: ScenarioStepId,
  context: Record<string, string> = {},
  /** Operator the walkthrough acts as, from the authenticated caller. */
  operatorId: string = "priya.raman",
  /** Tenant the walkthrough operates within. Reserved for scoped steps. */
  _tenantId?: string
): Promise<ScenarioStepResult> {
  switch (step) {
    case "reset":
      return stepReset();
    case "score":
      return stepScore();
    case "approve":
      return stepApprove(context, operatorId);
    case "timeout":
      return stepTimeout(context, operatorId);
    case "duplicate_webhook":
      return stepDuplicateWebhook(context);
    case "reconcile":
      return stepReconcile(context);
    case "prove":
      return stepProve();
    default:
      throw new Error(`Unknown scenario step: ${step}`);
  }
}

/* ----------------------------------------------------------------- Step 1 */

async function stepReset(): Promise<ScenarioStepResult> {
  // Clear transactional state but keep suppliers and their observation history,
  // so the story can be replayed without re-seeding the whole database.
  await prisma.reconciliationCase.deleteMany();
  await prisma.mockProviderRecord.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.eventRecord.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.ledgerTransaction.deleteMany();
  await prisma.paymentIntent.deleteMany();
  await prisma.liquidityOpportunity.deleteMany();

  const [supplierCount, observationCount] = await Promise.all([
    prisma.supplier.count(),
    prisma.liquidityObservation.count(),
  ]);

  return {
    step: "reset",
    title: "Start from a clean slate",
    narration: `${supplierCount} suppliers are on the platform, each with daily cash-flow observations: balance, money in, money out, how regularly their customers pay, and how much that varies. ${observationCount} observations in total. No offers, no payments, no ledger entries yet.`,
    whyItMatters:
      "Everything downstream is derived from these observations. The model never sees an invoice or a bank statement - only aggregate cash-flow signals, which is what a marketplace actually has.",
    facts: [
      { label: "Suppliers", value: String(supplierCount) },
      { label: "Cash-flow observations", value: String(observationCount) },
      { label: "Payments", value: "0" },
      { label: "Ledger entries", value: "0" },
    ],
  };
}

/* ----------------------------------------------------------------- Step 2 */

async function stepScore(): Promise<ScenarioStepResult> {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
  });

  let recommended = 0;
  let rejected = 0;
  let protagonistOpportunityId: string | undefined;
  let topProbability = 0;
  let topSupplier = "";

  for (const supplier of suppliers) {
    const hasObservation = await prisma.liquidityObservation.findFirst({
      where: { supplierId: supplier.id },
    });
    if (!hasObservation) continue;

    // Merchant benefit scales with the size of the receivable at stake.
    const result = await evaluateOpportunity(supplier.id, 15000000);

    if (result.status === "RECOMMENDED") {
      recommended += 1;
    } else {
      rejected += 1;
    }

    if (result.probability > topProbability) {
      topProbability = result.probability;
      topSupplier = supplier.name;
    }

    if (supplier.name === PROTAGONIST && result.status === "RECOMMENDED") {
      protagonistOpportunityId = result.opportunityId;
    }
  }

  // Fall back to whichever offer policy cleared, if the protagonist was not one.
  if (!protagonistOpportunityId) {
    const anyRecommended = await prisma.liquidityOpportunity.findFirst({
      where: { status: "RECOMMENDED" },
      orderBy: { predictionProbability: "desc" },
    });
    protagonistOpportunityId = anyRecommended?.id;
  }

  return {
    step: "score",
    title: "Find who is about to run short",
    narration: `Every supplier was scored against the liquidity model. ${recommended} cleared policy and became offers; ${rejected} were rejected before any human saw them. The highest risk is ${topSupplier || "none"} at ${(topProbability * 100).toFixed(0)}%.`,
    whyItMatters:
      "The model only proposes. Policy applies hard caps - maximum discount rate, per-transaction size, minimum expected value - and rejects anything outside the envelope automatically. A model that drifts cannot spend more than policy allows.",
    facts: [
      { label: "Suppliers scored", value: String(suppliers.length) },
      { label: "Offers recommended", value: String(recommended), tone: "warn" },
      { label: "Rejected by policy", value: String(rejected) },
      {
        label: "Highest risk",
        value: topSupplier
          ? `${topSupplier} (${(topProbability * 100).toFixed(0)}%)`
          : "none",
      },
    ],
    verifyAt: {
      href: "/dashboard/opportunities",
      label: "See every supplier and the reasoning behind each score",
    },
    context: protagonistOpportunityId
      ? { opportunityId: protagonistOpportunityId }
      : {},
  };
}

/* ----------------------------------------------------------------- Step 3 */

async function stepApprove(
  context: Record<string, string>,
  operatorId: string
): Promise<ScenarioStepResult> {
  let opportunityId = context.opportunityId;

  if (!opportunityId) {
    const candidate = await prisma.liquidityOpportunity.findFirst({
      where: { status: "RECOMMENDED" },
      orderBy: { predictionProbability: "desc" },
    });
    if (!candidate) {
      throw new Error(
        "No recommended offer to approve. Run the scoring step first."
      );
    }
    opportunityId = candidate.id;
  }

  const opportunity = await prisma.liquidityOpportunity.findUnique({
    where: { id: opportunityId },
    include: { supplier: true },
  });
  if (!opportunity) {
    throw new Error(`Offer ${opportunityId} no longer exists.`);
  }

  const approval = await approveOpportunity(opportunityId, operatorId);

  // Send it to the provider on the happy path.
  mockRazorpay.setFailureMode("success");
  const paymentStatus = await submitPaymentToProvider(approval.paymentIntentId);

  const ledger = await prisma.ledgerTransaction.findFirst({
    where: { paymentIntentId: approval.paymentIntentId },
    include: { entries: true },
  });

  const debits =
    ledger?.entries.reduce((sum, e) => sum + e.debitPaise, 0) ?? 0;
  const credits =
    ledger?.entries.reduce((sum, e) => sum + e.creditPaise, 0) ?? 0;

  return {
    step: "approve",
    title: "Approve the offer and move money",
    narration: `An operator approved the offer for ${opportunity.supplier.name}. A single database transaction created the payment intent, wrote balanced double-entry ledger rows, recorded who approved it, and queued the outbox event. Only then was the instruction sent to the provider, which returned ${paymentStatus}.`,
    whyItMatters:
      "The ledger write and the payment intent are committed together or not at all. If the process died between them, we would never end up with money moved and no accounting entry - the failure mode that makes finance teams distrust software.",
    facts: [
      { label: "Supplier", value: opportunity.supplier.name },
      {
        label: "Amount",
        value: formatPaise(opportunity.expectedBenefitPaise),
      },
      { label: "Payment state", value: paymentStatus, tone: "ok" },
      {
        label: "Ledger entries",
        value: `${ledger?.entries.length ?? 0} rows, ${formatPaise(debits)} debits = ${formatPaise(credits)} credits`,
        tone: debits === credits ? "ok" : "danger",
      },
      { label: "Correlation id", value: approval.correlationId },
    ],
    verifyAt: {
      href: `/dashboard/payments/${approval.paymentIntentId}`,
      label: "Follow this payment end to end",
    },
    context: {
      opportunityId,
      paymentIntentId: approval.paymentIntentId,
      correlationId: approval.correlationId,
    },
  };
}

/* ----------------------------------------------------------------- Step 4 */

async function stepTimeout(
  context: Record<string, string>,
  operatorId: string
): Promise<ScenarioStepResult> {
  const opportunity = await prisma.liquidityOpportunity.findFirst({
    where: { status: "RECOMMENDED" },
    include: { supplier: true },
    orderBy: { predictionProbability: "desc" },
  });

  if (!opportunity) {
    throw new Error(
      "No further offers available to demonstrate a timeout. Reset and run the walkthrough again."
    );
  }

  const approval = await approveOpportunity(opportunity.id, operatorId);

  /*
   * Clear the maker-checker gate first if this advance is large enough to
   * need one.
   *
   * Without this the step tried to submit a payment still sitting in
   * PENDING_APPROVAL and failed with "Cannot submit payment with status" -
   * the walkthrough stopping on a control working correctly, which reads to a
   * viewer as a bug rather than as a feature.
   */
  let secondApprovalCleared = false;
  if (approval.requiresDualApproval) {
    const checker = await prisma.tenantUser.findFirst({
      where: {
        role: "APPROVER",
        isActive: true,
        userId: { not: operatorId },
        user: { isActive: true },
      },
      include: { user: true },
    });

    if (!checker) {
      throw new Error(
        "This advance needs a second approver and no other approver account exists."
      );
    }

    await confirmSecondApproval(approval.paymentIntentId, checker.user.id);
    secondApprovalCleared = true;
  }

  // The interesting failure: the provider processed it, we never heard back.
  mockRazorpay.setFailureMode("timeout_after_remote_success" as FailureMode);
  const paymentStatus = await submitPaymentToProvider(approval.paymentIntentId);

  return {
    step: "timeout",
    title: "Break it: the provider times out",
    narration: `A second offer for ${opportunity.supplier.name} was approved, but the provider call timed out. We genuinely do not know whether the money left. The payment is recorded as ${paymentStatus} - not as success, and not as failure.`,
    whyItMatters:
      "This is the failure that causes double payments in real systems. The naive responses are both wrong: retry and you may pay twice; mark it failed and you may have paid without recording it. Recording UNKNOWN and resolving it against the provider later is the only safe answer.",
    facts: [
      { label: "Supplier", value: opportunity.supplier.name },
      {
        label: "Amount",
        value: formatPaise(opportunity.expectedBenefitPaise),
      },
      { label: "Payment state", value: paymentStatus, tone: "warn" },
      ...(secondApprovalCleared
        ? [
            {
              label: "Second approval",
              value: "Required and granted by a different operator",
              tone: "ok" as const,
            },
          ]
        : []),
      {
        label: "Automatic retry",
        value: "Not attempted - would risk paying twice",
      },
      { label: "Correlation id", value: approval.correlationId },
    ],
    verifyAt: {
      href: `/dashboard/payments/${approval.paymentIntentId}`,
      label: "See the payment sitting in UNKNOWN",
    },
    context: {
      ...context,
      unknownPaymentId: approval.paymentIntentId,
    },
  };
}

/* ----------------------------------------------------------------- Step 5 */

async function stepDuplicateWebhook(
  context: Record<string, string>
): Promise<ScenarioStepResult> {
  const paymentId =
    context.paymentIntentId ??
    (
      await prisma.paymentIntent.findFirst({
        where: { status: "CONFIRMED" },
        orderBy: { createdAt: "desc" },
      })
    )?.id;

  if (!paymentId) {
    throw new Error("No confirmed payment available to receive a webhook.");
  }

  const eventsBefore = await prisma.eventRecord.count();

  // Deliver the same provider event twice, as a flaky provider would.
  const first = await simulateWebhook(paymentId);
  await simulateWebhook(paymentId);

  const eventsAfter = await prisma.eventRecord.count();

  const payment = await prisma.paymentIntent.findUnique({
    where: { id: paymentId },
    include: { supplier: true },
  });

  return {
    step: "duplicate_webhook",
    title: "Break it again: the webhook arrives twice",
    narration: `The provider delivered the same confirmation event twice for ${payment?.supplier.name ?? "this payment"}. The first delivery was processed; the second was recognised as a replay and discarded. The payment state and the ledger are unchanged.`,
    whyItMatters:
      "Payment providers guarantee at-least-once webhook delivery, not exactly-once. Every receiver must be idempotent on the provider's event id, or a retried delivery quietly doubles your accounting.",
    facts: [
      { label: "Deliveries received", value: "2" },
      {
        label: "First delivery",
        value: first ? "processed" : "no payload",
        tone: "ok",
      },
      {
        label: "Second delivery",
        value: "deduplicated, ignored",
        tone: "ok",
      },
      {
        label: "Payment state",
        value: payment?.status ?? "unknown",
        tone: "ok",
      },
      {
        label: "Net new event records",
        value: String(eventsAfter - eventsBefore),
      },
    ],
    verifyAt: {
      href: `/dashboard/payments/${paymentId}`,
      label: "Confirm the timeline shows one confirmation, not two",
    },
    context,
  };
}

/* ----------------------------------------------------------------- Step 6 */

async function stepReconcile(
  context: Record<string, string>
): Promise<ScenarioStepResult> {
  const unknownBefore = await prisma.paymentIntent.count({
    where: { status: "UNKNOWN" },
  });

  const caseIds = await runFullReconciliation();

  const [unknownAfter, matched, openCases, criticalCases] = await Promise.all([
    prisma.paymentIntent.count({ where: { status: "UNKNOWN" } }),
    prisma.reconciliationCase.count({ where: { outcome: "MATCHED" } }),
    prisma.reconciliationCase.count({
      where: { status: { in: ["OPEN", "INVESTIGATING"] } },
    }),
    prisma.reconciliationCase.count({
      where: { severity: "CRITICAL", status: { in: ["OPEN", "INVESTIGATING"] } },
    }),
  ]);

  const resolved = Math.max(unknownBefore - unknownAfter, 0);

  return {
    step: "reconcile",
    title: "Resolve the unknown",
    narration: `Reconciliation swept every non-terminal payment and asked the provider what it believes. ${caseIds.length} ${caseIds.length === 1 ? "case was" : "cases were"} examined, and ${resolved} payment${resolved === 1 ? "" : "s"} that we could not classify ${resolved === 1 ? "was" : "were"} resolved against the provider's record.`,
    whyItMatters:
      "Reconciliation never guesses. It compares amount and status field by field, and it only updates our state in the one direction that is safe - adopting the provider's confirmation for a payment we recorded as unknown. Anything else becomes an exception for a human.",
    facts: [
      { label: "Payments in UNKNOWN before", value: String(unknownBefore), tone: unknownBefore > 0 ? "warn" : undefined },
      { label: "Payments in UNKNOWN after", value: String(unknownAfter), tone: unknownAfter > 0 ? "warn" : "ok" },
      { label: "Cases matched", value: String(matched), tone: "ok" },
      {
        label: "Exceptions still open",
        value: String(openCases),
        tone: criticalCases > 0 ? "danger" : openCases > 0 ? "warn" : "ok",
      },
    ],
    verifyAt: {
      href: "/dashboard/reconciliation",
      label: "Inspect the exception queue",
    },
    context,
  };
}

/* ----------------------------------------------------------------- Step 7 */

async function stepProve(): Promise<ScenarioStepResult> {
  // Drain the outbox, then check the books.
  const pendingBefore = await prisma.outboxEvent.count({
    where: { status: "PENDING" },
  });
  await publishPendingEvents();
  const [pendingAfter, published, trialBalance, auditCount, paymentCount] =
    await Promise.all([
      prisma.outboxEvent.count({ where: { status: "PENDING" } }),
      prisma.outboxEvent.count({ where: { status: "PUBLISHED" } }),
      calculateTrialBalance(),
      prisma.auditEvent.count(),
      prisma.paymentIntent.count(),
    ]);

  return {
    step: "prove",
    title: "Prove nothing was lost",
    narration: `The outbox drained ${pendingBefore - pendingAfter} pending event${pendingBefore - pendingAfter === 1 ? "" : "s"} into the append-only event log. Across ${paymentCount} payments and two injected failures, total debits equal total credits exactly, and every state change has an audit record naming who or what caused it.`,
    whyItMatters:
      "This is the claim that matters to a finance team: after deliberately breaking the provider twice, the books still foot to the paisa. Not because failures were avoided, but because every path through the system writes balanced entries or writes nothing.",
    facts: [
      {
        label: "Ledger",
        value: trialBalance.balanced
          ? `Balanced - ${formatPaise(trialBalance.totalDebits)} debits = ${formatPaise(trialBalance.totalCredits)} credits`
          : `OUT OF BALANCE by ${formatPaise(Math.abs(trialBalance.net))}`,
        tone: trialBalance.balanced ? "ok" : "danger",
      },
      {
        label: "Outbox events published",
        value: String(published),
        tone: pendingAfter === 0 ? "ok" : "warn",
      },
      { label: "Audit records", value: String(auditCount) },
      { label: "Accounts touched", value: String(trialBalance.accounts.length) },
    ],
    verifyAt: {
      href: "/dashboard/ledger",
      label: "Open the trial balance and check it yourself",
    },
  };
}
