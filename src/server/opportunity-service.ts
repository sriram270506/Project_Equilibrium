import { prisma } from "@/src/lib/prisma";
import { evaluateModel, LIQUIDITY_MODEL } from "@/src/lib/ml/model-artifact";
import { evaluatePolicy } from "@/src/lib/economic-policy";
import { generateId, generatePaymentId, generateIdempotencyKey } from "@/src/lib/ids";
import { createAuditEvent } from "@/src/lib/audit";
import { generateRequestFingerprint } from "@/src/lib/idempotency";
import {
  assertOpportunityTransition,
  OpportunityStatus,
} from "@/src/lib/state-machine";
import { assertLedgerBalanced } from "@/src/lib/ledger/trial-balance";
import {
  checkRiskControls,
  RiskControlError,
} from "@/src/lib/risk/controls";
import { FeatureSnapshot } from "@/src/lib/ml/model-artifact";
import { buildFeatures } from "@/src/lib/ml/features";
import { buildEarlyPaymentJournal } from "@/src/lib/ledger/accounts";
import { percentageOfPaise } from "@/src/lib/money";

/**
 * Evaluate opportunity for a supplier
 */
export async function evaluateOpportunity(
  supplierId: string,
  merchantBenefitPaise: number,
  platformOpportunityCostPaise: number = 5000,
  estimatedRiskPaise: number = 50000,
  /**
   * Optional stable id. Runtime scoring mints a UUID; the seed passes an
   * explicit id so a seeded database is byte-identical between runs and two
   * reviewers can diff their databases.
   */
  opportunityIdOverride?: string
) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier) {
    throw new Error(`Supplier not found: ${supplierId}`);
  }

  // Get latest liquidity observation
  const latestObservation = await prisma.liquidityObservation.findFirst({
    where: { supplierId },
    orderBy: { observedAt: "desc" },
  });

  if (!latestObservation) {
    throw new Error(`No liquidity observations for supplier: ${supplierId}`);
  }

  /*
   * Build features through the shared constructor so that what we score with
   * here is identical to what the model was trained on. Doing this inline was
   * how an earlier version ended up negating a feature that already carried a
   * negative coefficient, scoring every supplier at 99%.
   */
  const tenureDays = Math.max(
    Math.floor(
      (Date.now() - supplier.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    ),
    1
  );

  const features: FeatureSnapshot = buildFeatures(latestObservation, tenureDays);

  // Evaluate model
  const modelProbability = evaluateModel(features);

  // Estimate payout amount (simplified)
  const payoutAmountPaise = Math.min(
    Math.floor(latestObservation.availableBalancePaise * 0.3),
    500000
  );

  // Evaluate policy
  const policyEval = evaluatePolicy({
    modelProbability,
    supplierPayableAmountPaise: payoutAmountPaise,
    proposedDiscountBps: 120,
    merchantBenefitPaise,
    platformOpportunityCostPaise,
    estimatedRiskPaise,
  });

  // Create opportunity record
  const opportunityId = opportunityIdOverride ?? generateId();

  await prisma.liquidityOpportunity.create({
    data: {
      id: opportunityId,
      // Inherited from the supplier rather than passed in: the tenant that owns
      // the supplier necessarily owns any offer made to them, and deriving it
      // removes the chance of a caller planting a record in another tenant.
      tenantId: supplier.tenantId,
      supplierId,
      predictionProbability: modelProbability,
      // Stamped from the artifact, not a literal, so stored provenance always
      // names the model that actually produced the score.
      modelVersion: LIQUIDITY_MODEL.modelVersion,
      featureSnapshotJson: JSON.stringify(features),
      policyVersion: policyEval.policyVersion,
      expectedBenefitPaise: policyEval.riskEnvelope.estimatedBenefitPaise,
      opportunityCostPaise: platformOpportunityCostPaise,
      riskCostPaise: policyEval.riskEnvelope.estimatedRiskPaise,
      expectedValuePaise: policyEval.expectedValuePaise,
      recommendedDiscountBps: policyEval.recommendedDiscountBps,
      maxAllowedDiscountPaise: policyEval.maxAllowedDiscountPaise,
      status: policyEval.approvedByPolicy ? "RECOMMENDED" : "REJECTED",
      decisionReason: policyEval.decisionReason,
    },
  });

  // Audit
  await createAuditEvent({
    eventType: "OPPORTUNITY_EVALUATED",
    actorType: "MODEL",
    actorId: "liquidity-model",
    aggregateType: "OPPORTUNITY",
    aggregateId: opportunityId,
    payload: {
      modelProbability,
      policyDecision: policyEval.approvedByPolicy,
      expectedValue: policyEval.expectedValuePaise,
    },
    modelVersion: LIQUIDITY_MODEL.modelVersion,
    policyVersion: policyEval.policyVersion,
    supplierId,
    tenantId: supplier.tenantId,
  });

  return {
    opportunityId,
    probability: modelProbability,
    expectedValue: policyEval.expectedValuePaise,
    status: policyEval.approvedByPolicy ? "RECOMMENDED" : "REJECTED",
    decisionReason: policyEval.decisionReason,
  };
}

/**
 * Approve opportunity and create payment intent
 * All writes are atomic - succeeds or fails as a unit
 */
export async function approveOpportunity(
  opportunityId: string,
  operatorId: string = "demo-finance-operator"
) {
  const existing = await prisma.liquidityOpportunity.findUnique({
    where: { id: opportunityId },
  });

  if (!existing) {
    throw new Error(`Opportunity not found: ${opportunityId}`);
  }

  // Fail fast with a useful message before doing any work.
  if (existing.status !== "RECOMMENDED") {
    throw new Error(
      `Cannot approve opportunity with status: ${existing.status}`
    );
  }

  assertOpportunityTransition(existing.status as OpportunityStatus, "APPROVED");

  /*
   * Claim the opportunity with a compare-and-swap BEFORE doing anything else.
   *
   * The check above is necessary for a good error message but is not sufficient
   * on its own: between reading the row and writing the payment, another
   * request can read the same RECOMMENDED row and both can proceed, producing
   * two payment intents and paying the supplier twice.
   *
   * `updateMany` with the status in the WHERE clause compiles to a single
   * conditional UPDATE. Exactly one concurrent caller can match a row whose
   * status is still RECOMMENDED; every other caller matches zero rows and is
   * turned away here, before any money is committed.
   */
  const claim = await prisma.liquidityOpportunity.updateMany({
    where: { id: opportunityId, status: "RECOMMENDED" },
    data: { status: "APPROVED" },
  });

  if (claim.count === 0) {
    throw new Error(
      `Cannot approve opportunity with status: already claimed by another request`
    );
  }

  const opportunity = existing;

  /**
   * Put the opportunity back if we claimed it but cannot go through with the
   * approval. Without this, a rejection by risk controls would strand the offer
   * in APPROVED with no payment behind it - permanently unapprovable, and
   * invisible on the dashboard.
   */
  const releaseClaim = async () => {
    await prisma.liquidityOpportunity.updateMany({
      where: { id: opportunityId, status: "APPROVED" },
      data: { status: "RECOMMENDED" },
    });
  };

  /*
   * Risk controls run before anything is written.
   *
   * The model decided this supplier needs cash and policy decided the price is
   * fair, but neither of them knows how much has already gone out today. These
   * limits are the ones that must hold even if the model is wrong, the feature
   * pipeline is broken, or an operator has been talked into something.
   */
  const risk = await checkRiskControls(
    opportunity.supplierId,
    opportunity.expectedBenefitPaise
  );

  if (!risk.allowed) {
    await releaseClaim();
    throw new RiskControlError(
      risk.violations.map((v) => v.message).join(" "),
      risk.violations
    );
  }

  /*
   * Maker-checker: above the threshold, the operator who approves is only the
   * maker. The payment is created but parked in PENDING_APPROVAL until a
   * second, different person signs it off. One person must never be able to
   * move a large sum alone.
   */
  const requiresDualApproval = risk.requiresDualApproval;
  const initialStatus = requiresDualApproval
    ? "PENDING_APPROVAL"
    : "INTENT_CREATED";

  // Prepare all data before transaction
  const correlationId = generateId("corr");
  const paymentIntentId = generateId();
  const providerPaymentId = generatePaymentId();
  const providerIdempotencyKey = generateIdempotencyKey();
  const internalReference = `INT_${Date.now()}`;

  const requestPayload = {
    supplier_id: opportunity.supplierId,
    amount_paise: opportunity.expectedBenefitPaise,
    discount_bps: opportunity.recommendedDiscountBps,
    operation_type: "DISCOUNT_PAYOUT",
  };

  const requestFingerprint = generateRequestFingerprint(requestPayload);

  /*
   * The invoice this advance is priced against. `expectedBenefitPaise` is what
   * the supplier receives today; the face value is what the platform recovers
   * on the due date, and the difference is the discount income.
   */
  const DAYS_EARLY = 27;
  const faceValuePaise =
    opportunity.expectedBenefitPaise +
    percentageOfPaise(
      opportunity.expectedBenefitPaise,
      opportunity.recommendedDiscountBps
    );

  // Atomic transaction: all writes succeed or all fail. If it throws, the
  // claim is released so the offer returns to the queue rather than vanishing.
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    // 1. Create payment intent
    const paymentIntent = await tx.paymentIntent.create({
      data: {
        id: paymentIntentId,
        internalReference,
        provider: "RAZORPAY",
        providerPaymentId,
        operationType: "DISCOUNT_PAYOUT",
        amountPaise: opportunity.expectedBenefitPaise,
        currency: "INR",
        status: initialStatus,
        requestFingerprint,
        providerIdempotencyKey,
        correlationId,
        tenantId: opportunity.tenantId,
        supplierId: opportunity.supplierId,
        makerId: operatorId,
        approvalThresholdPaise: requiresDualApproval
          ? risk.limits.dualApprovalThresholdPaise
          : null,
        approvedAt: requiresDualApproval ? null : new Date(),
      },
    });

    /*
     * 2. Post the journal.
     *
     * Built and validated by buildEarlyPaymentJournal, which throws rather than
     * returning anything unbalanced - so an unbalanced transaction cannot reach
     * the database at all. The previous version posted a two-leg entry that
     * balanced but recorded no income, no provider fee, no funding cost, and
     * debited cash for money going out.
     */
    const journal = buildEarlyPaymentJournal({
      faceValuePaise: faceValuePaise,
      advancePaise: opportunity.expectedBenefitPaise,
      daysEarly: DAYS_EARLY,
    });

    await tx.ledgerTransaction.create({
      data: {
        id: generateId(),
        referenceType: "PAYMENT_INTENT",
        referenceId: paymentIntentId,
        currency: "INR",
        description: `Early payment to supplier, offer ${opportunityId}`,
        paymentIntentId,
        entries: {
          create: journal.map((leg) => ({
            id: generateId(),
            accountCode: leg.accountCode,
            debitPaise: leg.debitPaise,
            creditPaise: leg.creditPaise,
          })),
        },
      },
    });

    // 3. Create audit event, inside the transaction so it commits with the
    //    change it describes. Goes through createAuditEvent so the hash chain
    //    is extended rather than bypassed.
    await createAuditEvent(
      {
        eventType: "OPPORTUNITY_APPROVED",
        actorType: "OPERATOR",
        actorId: operatorId,
        aggregateType: "OPPORTUNITY",
        aggregateId: opportunityId,
        payload: {
          payment_intent_id: paymentIntentId,
          correlation_id: correlationId,
          amount_paise: opportunity.expectedBenefitPaise,
          requires_dual_approval: requiresDualApproval,
        },
        modelVersion: opportunity.modelVersion,
        policyVersion: opportunity.policyVersion,
        correlationId,
        supplierId: opportunity.supplierId,
      },
      tx
    );

    // 4. Create outbox event for eventual publishing
    await tx.outboxEvent.create({
      data: {
        id: generateId(),
        eventType: "PAYMENT_INTENT_CREATED",
        aggregateType: "PAYMENT_INTENT",
        aggregateId: paymentIntentId,
        payloadJson: JSON.stringify({
          amount_paise: opportunity.expectedBenefitPaise,
          supplier_id: opportunity.supplierId,
          opportunity_id: opportunityId,
        }),
        status: "PENDING",
        correlationId,
        paymentIntentId,
      },
    });

    // The opportunity was already claimed atomically before this transaction
    // opened, so there is no status update to make here.

      return paymentIntent;
    });
  } catch (error) {
    await releaseClaim();
    throw error;
  }

  // Verify ledger invariant after transaction
  await assertLedgerBalanced();

  return {
    paymentIntentId: result.id,
    status: initialStatus,
    correlationId,
    requiresDualApproval,
    dualApprovalThresholdPaise: risk.limits.dualApprovalThresholdPaise,
  };
}

/**
 * Second approval for a payment held above the maker-checker threshold.
 *
 * The checker must be a different person from the maker. This is enforced here
 * rather than in the UI, because a control that only exists in the interface is
 * not a control.
 */
export async function confirmSecondApproval(
  paymentIntentId: string,
  checkerId: string
) {
  const payment = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });

  if (!payment) {
    throw new Error(`Payment not found: ${paymentIntentId}`);
  }

  if (payment.status !== "PENDING_APPROVAL") {
    throw new Error(
      `Payment ${paymentIntentId} is not awaiting a second approval (status: ${payment.status})`
    );
  }

  if (payment.makerId && payment.makerId === checkerId) {
    throw new Error(
      "The second approver must be a different person from the one who raised this payment."
    );
  }

  // Re-check the limits: time has passed, and today's exposure may have moved.
  const risk = await checkRiskControls(payment.supplierId, payment.amountPaise);
  if (!risk.allowed) {
    throw new RiskControlError(
      risk.violations.map((v) => v.message).join(" "),
      risk.violations
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        status: "INTENT_CREATED",
        checkerId,
        approvedAt: new Date(),
      },
    });

    await createAuditEvent(
      {
        eventType: "SECOND_APPROVAL_GRANTED",
        actorType: "OPERATOR",
        actorId: checkerId,
        aggregateType: "PAYMENT_INTENT",
        aggregateId: paymentIntentId,
        payload: {
          maker: payment.makerId,
          checker: checkerId,
          amount_paise: payment.amountPaise,
        },
        correlationId: payment.correlationId,
        supplierId: payment.supplierId,
      },
      tx
    );
  });

  return { paymentIntentId, status: "INTENT_CREATED", checkerId };
}
