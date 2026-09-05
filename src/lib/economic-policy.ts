import { percentageOfPaise } from "./money";
import { APPROVAL_THRESHOLD } from "./ml/model-artifact";

// Pure policy evaluation constants
export const DEFAULT_MAX_DISCOUNT_PERCENTAGE = 15; // 15% max discount
export const DEFAULT_EXPECTED_VALUE_MULTIPLIER = 1.5; // Expected benefit multiplier

export interface PolicyConstraints {
  maxDiscountBps: number;
  maxSingleDiscountCostPaise: number;
  minExpectedValuePaise: number;
  dailyExposureLimitPaise: number;
  perTransactionCapPaise: number;
  /**
   * Minimum model probability before policy will consider an offer.
   *
   * This deliberately defaults to the threshold the model was FITTED with
   * (see scripts/train-model.ts), not to a hand-picked 0.5. Policy and model
   * disagreeing about what counts as "at risk" is a silent way to make a
   * carefully calibrated model useless - an earlier version gated at 0.5 while
  * the model was tuned to act at 0.15, which rejected most genuinely
   * distressed suppliers before a human ever saw them.
   */
  minModelProbability: number;
}

export const DEFAULT_POLICY_CONSTRAINTS: PolicyConstraints = {
  maxDiscountBps: 150, // 1.5%
  maxSingleDiscountCostPaise: 250000, // ₹2,500
  minExpectedValuePaise: 0, // ₹0 (can be negative if policy chooses)
  dailyExposureLimitPaise: 20000000, // ₹2,00,000
  perTransactionCapPaise: 500000, // ₹5,000
  minModelProbability: APPROVAL_THRESHOLD,
};

export interface PolicyEvaluation {
  approvedByPolicy: boolean;
  expectedValuePaise: number;
  recommendedDiscountBps: number;
  maxAllowedDiscountPaise: number;
  decisionReason: string;
  policyVersion: string;
  riskEnvelope: {
    probabilityOfNeed: number;
    estimatedBenefitPaise: number;
    estimatedRiskPaise: number;
    opportunityCostPaise: number;
  };
}

/**
 * Evaluate an opportunity against policy constraints
 */
export function evaluatePolicy(params: {
  modelProbability: number;
  supplierPayableAmountPaise: number;
  proposedDiscountBps: number;
  merchantBenefitPaise: number;
  platformOpportunityCostPaise: number;
  estimatedRiskPaise: number;
  policyVersion?: string;
  constraints?: PolicyConstraints;
}): PolicyEvaluation {
  const {
    modelProbability,
    supplierPayableAmountPaise,
    proposedDiscountBps,
    merchantBenefitPaise,
    platformOpportunityCostPaise,
    estimatedRiskPaise,
    policyVersion = "policy-v1-demo",
    constraints = DEFAULT_POLICY_CONSTRAINTS,
  } = params;

  // Clamp probability to [0, 1]
  const probability = Math.min(Math.max(modelProbability, 0), 1);

  // Calculate discount amounts
  const discountCostPaise = percentageOfPaise(
    supplierPayableAmountPaise,
    proposedDiscountBps
  );

  // Calculate expected value components
  const expectedBenefitPaise = Math.round(probability * merchantBenefitPaise);
  const riskCostPaise = Math.round((1 - probability) * estimatedRiskPaise);

  const expectedValuePaise =
    expectedBenefitPaise - platformOpportunityCostPaise - riskCostPaise;

  // Policy checks
  const violations: string[] = [];

  if (proposedDiscountBps > constraints.maxDiscountBps) {
    violations.push(
      `Discount ${proposedDiscountBps} bps exceeds max ${constraints.maxDiscountBps} bps`
    );
  }

  if (discountCostPaise > constraints.maxSingleDiscountCostPaise) {
    violations.push(
      `Discount cost ₹${discountCostPaise / 100} exceeds max ₹${constraints.maxSingleDiscountCostPaise / 100}`
    );
  }

  if (expectedValuePaise < constraints.minExpectedValuePaise) {
    violations.push(
      `Expected value ₹${expectedValuePaise / 100} below minimum ₹${constraints.minExpectedValuePaise / 100}`
    );
  }

  if (discountCostPaise > constraints.perTransactionCapPaise) {
    violations.push(
      `Per-transaction cap exceeded: ₹${discountCostPaise / 100} > ₹${constraints.perTransactionCapPaise / 100}`
    );
  }

  if (probability < constraints.minModelProbability) {
    violations.push(
      `Model probability ${(probability * 100).toFixed(0)}% below the ${(constraints.minModelProbability * 100).toFixed(0)}% action threshold`
    );
  }

  // Determine approval
  const approvedByPolicy = violations.length === 0;

  const decisionReason = approvedByPolicy
    ? `Policy approved: discount within limits, positive expected value of ₹${expectedValuePaise / 100}`
    : `Policy rejected: ${violations.join("; ")}`;

  // Calculate recommended discount that fits policy
  let recommendedDiscountBps = proposedDiscountBps;
  const maxAllowedFromCap = Math.min(
    constraints.maxSingleDiscountCostPaise,
    constraints.perTransactionCapPaise
  );
  if (discountCostPaise > maxAllowedFromCap) {
    recommendedDiscountBps = Math.floor(
      (maxAllowedFromCap * 10000) / supplierPayableAmountPaise
    );
  }

  return {
    approvedByPolicy,
    expectedValuePaise,
    recommendedDiscountBps,
    maxAllowedDiscountPaise: Math.min(
      constraints.maxSingleDiscountCostPaise,
      constraints.perTransactionCapPaise
    ),
    decisionReason,
    policyVersion,
    riskEnvelope: {
      probabilityOfNeed: probability,
      estimatedBenefitPaise: expectedBenefitPaise,
      estimatedRiskPaise: riskCostPaise,
      opportunityCostPaise: platformOpportunityCostPaise,
    },
  };
}

/**
 * Pure helper: Evaluate an opportunity for approval
 * Takes amount, discount, probability, risk tier and returns decision
 */
export interface OpportunityEvaluation {
  decision: "APPROVE" | "REJECT";
  reason: string;
  expectedValuePaise: number;
  expectedBenefitPaise: number;
  maxAllowedDiscountPaise: number;
}

export interface OpportunityEvaluationInput {
  amountPaise: number;
  recommendedDiscountBps: number;
  modelProbability: number;
  riskTier: "TIER_1" | "TIER_2" | "TIER_3";
}

export function evaluateOpportunity(
  input: OpportunityEvaluationInput
): OpportunityEvaluation {
  const {
    amountPaise,
    recommendedDiscountBps,
    modelProbability,
    riskTier,
  } = input;

  // Risk tier adjustment (TIER_1 = lowest risk, TIER_3 = highest risk)
  const riskMultiplier = riskTier === "TIER_1" ? 1.0 : riskTier === "TIER_2" ? 0.8 : 0.6;

  // Discount as percentage (e.g., 500 bps = 5%)
  const discountPercentage = recommendedDiscountBps / 100;

  // Check if discount exceeds maximum
  const maxDiscountPaise = Math.round(
    amountPaise * (DEFAULT_MAX_DISCOUNT_PERCENTAGE / 100)
  );
  const discountAmountPaise = Math.round(amountPaise * (discountPercentage / 100));

  // Rejection criteria 1: Discount percentage exceeds max
  if (discountPercentage > DEFAULT_MAX_DISCOUNT_PERCENTAGE) {
    return {
      decision: "REJECT",
      reason: `Discount ${discountPercentage}% exceeds maximum ${DEFAULT_MAX_DISCOUNT_PERCENTAGE}%`,
      expectedValuePaise: 0,
      expectedBenefitPaise: 0,
      maxAllowedDiscountPaise: maxDiscountPaise,
    };
  }

  // Calculate expected benefit (discount amount * multiplier * probability)
  const expectedBenefitPaise = Math.round(
    discountAmountPaise * DEFAULT_EXPECTED_VALUE_MULTIPLIER * modelProbability * riskMultiplier
  );

  // Calculate expected value (benefit minus estimated costs - use much smaller cost estimates)
  const estimatedRiskCostPaise = Math.round(1000 * (1 - modelProbability));
  const platformCostPaise = 1000;
  const expectedValuePaise = expectedBenefitPaise - estimatedRiskCostPaise - platformCostPaise;

  // Approval criteria
  const isHighProbability = modelProbability >= 0.5;
  const isPositiveValue = expectedValuePaise > 0;

  const approved = isHighProbability && isPositiveValue;

  return {
    decision: approved ? "APPROVE" : "REJECT",
    reason: approved
      ? `Opportunity approved: ${(modelProbability * 100).toFixed(1)}% probability, expected value Rs${expectedValuePaise / 100}`
      : [
          !isHighProbability && `Probability ${(modelProbability * 100).toFixed(1)}% below 50% threshold`,
          !isPositiveValue && `Negative expected value Rs${expectedValuePaise / 100}`,
        ]
          .filter(Boolean)
          .join("; "),
    expectedValuePaise,
    expectedBenefitPaise,
    maxAllowedDiscountPaise: maxDiscountPaise,
  };
}
