import { percentageOfPaise } from "./money";

export interface PolicyConstraints {
  maxDiscountBps: number;
  maxSingleDiscountCostPaise: number;
  minExpectedValuePaise: number;
  dailyExposureLimitPaise: number;
  perTransactionCapPaise: number;
}

export const DEFAULT_POLICY_CONSTRAINTS: PolicyConstraints = {
  maxDiscountBps: 150, // 1.5%
  maxSingleDiscountCostPaise: 250000, // ₹2,500
  minExpectedValuePaise: 0, // ₹0 (can be negative if policy chooses)
  dailyExposureLimitPaise: 20000000, // ₹2,00,000
  perTransactionCapPaise: 500000, // ₹5,000
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

  if (probability < 0.5) {
    violations.push(`Model probability ${probability.toFixed(2)} below 50%`);
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
