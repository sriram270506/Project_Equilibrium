import { prisma } from "@/src/lib/prisma";
import { evaluateModel } from "@/src/lib/ml/model-artifact";
import { evaluatePolicy } from "@/src/lib/economic-policy";
import { generateId, generatePaymentId, generateIdempotencyKey } from "@/src/lib/ids";
import { createAuditEvent } from "@/src/lib/audit";
import { createOutboxEvent } from "@/src/lib/events/event-service";
import { generateRequestFingerprint } from "@/src/lib/idempotency";
import { FeatureSnapshot } from "@/src/lib/ml/model-artifact";

/**
 * Evaluate opportunity for a supplier
 */
export async function evaluateOpportunity(
  supplierId: string,
  merchantBenefitPaise: number,
  platformOpportunityCostPaise: number = 5000,
  estimatedRiskPaise: number = 50000
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

  // Prepare features
  const features: FeatureSnapshot = {
    cashFlowVolatility: latestObservation.volatility,
    daysRunwayTrend: -latestObservation.daysRunway, // Negative trend = lower runway
    paymentTimingRegularity: latestObservation.paymentRegularity,
    availableBalanceRatio:
      latestObservation.availableBalancePaise /
      (latestObservation.availableBalancePaise +
        latestObservation.outflowPaise +
        1),
    supplierTenureDays: 1000, // Mock value
  };

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
  const opportunityId = generateId();

  await prisma.liquidityOpportunity.create({
    data: {
      id: opportunityId,
      supplierId,
      predictionProbability: modelProbability,
      modelVersion: "liquidity-logistic-v1-demo",
      featureSnapshotJson: JSON.stringify(features),
      policyVersion: "policy-v1-demo",
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
    modelVersion: "liquidity-logistic-v1-demo",
    policyVersion: "policy-v1-demo",
    supplierId,
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
 */
export async function approveOpportunity(
  opportunityId: string,
  operatorId: string = "demo-finance-operator"
) {
  const opportunity = await prisma.liquidityOpportunity.findUnique({
    where: { id: opportunityId },
  });

  if (!opportunity) {
    throw new Error(`Opportunity not found: ${opportunityId}`);
  }

  if (opportunity.status !== "RECOMMENDED") {
    throw new Error(
      `Cannot approve opportunity with status: ${opportunity.status}`
    );
  }

  // Start transaction
  const correlationId = generateId("corr");
  const paymentIntentId = generateId();
  const providerPaymentId = generatePaymentId();
  const providerIdempotencyKey = generateIdempotencyKey();
  const internalReference = `INT_${Date.now()}`;

  // Create payment intent
  const requestPayload = {
    supplier_id: opportunity.supplierId,
    amount_paise: opportunity.expectedBenefitPaise,
    discount_bps: opportunity.recommendedDiscountBps,
    operation_type: "DISCOUNT_PAYOUT",
  };

  const requestFingerprint = generateRequestFingerprint(requestPayload);

  await prisma.paymentIntent.create({
    data: {
      id: paymentIntentId,
      internalReference,
      provider: "RAZORPAY",
      providerPaymentId,
      operationType: "DISCOUNT_PAYOUT",
      amountPaise: opportunity.expectedBenefitPaise,
      currency: "INR",
      status: "INTENT_CREATED",
      requestFingerprint,
      providerIdempotencyKey,
      correlationId,
      supplierId: opportunity.supplierId,
    },
  });

  // Create ledger transaction
  await prisma.ledgerTransaction.create({
    data: {
      id: generateId(),
      referenceType: "PAYMENT_INTENT",
      referenceId: paymentIntentId,
      currency: "INR",
      description: `Discount payout opportunity ${opportunityId}`,
      paymentIntentId,
      entries: {
        create: [
          {
            id: generateId(),
            accountCode: "PLATFORM_CASH",
            debitPaise: opportunity.expectedBenefitPaise,
            creditPaise: 0,
          },
          {
            id: generateId(),
            accountCode: "SUPPLIER_PAYABLE",
            debitPaise: 0,
            creditPaise: opportunity.expectedBenefitPaise,
          },
        ],
      },
    },
  });

  // Create audit event
  await createAuditEvent({
    eventType: "OPPORTUNITY_APPROVED",
    actorType: "OPERATOR",
    actorId: operatorId,
    aggregateType: "OPPORTUNITY",
    aggregateId: opportunityId,
    payload: {
      payment_intent_id: paymentIntentId,
      correlation_id: correlationId,
    },
    policyVersion: opportunity.policyVersion,
    supplierId: opportunity.supplierId,
  });

  // Create outbox event for eventual publishing
  await createOutboxEvent(
    "PAYMENT_INTENT_CREATED",
    "PAYMENT_INTENT",
    paymentIntentId,
    {
      amount_paise: opportunity.expectedBenefitPaise,
      supplier_id: opportunity.supplierId,
      opportunity_id: opportunityId,
    },
    correlationId,
    paymentIntentId
  );

  // Update opportunity status
  await prisma.liquidityOpportunity.update({
    where: { id: opportunityId },
    data: { status: "APPROVED" },
  });

  return {
    paymentIntentId,
    status: "INTENT_CREATED",
    correlationId,
  };
}
