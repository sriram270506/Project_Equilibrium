/**
 * Deterministic ML Model Artifact for Liquidity Prediction
 * 
 * This is a demo logistic regression model trained on synthetic Indian marketplace data.
 * It predicts the probability that a supplier will need liquidity within 7 days.
 * 
 * Model version: liquidity-logistic-v1-demo
 * Training window: 30 days of daily observations
 * Label definition: Binary - needs liquidity in next 7 days (based on cash flow stress)
 * Calibration: Synthetic data, NOT production-grade
 */

export interface FeatureSnapshot {
  cashFlowVolatility: number;
  daysRunwayTrend: number;
  paymentTimingRegularity: number;
  availableBalanceRatio: number;
  supplierTenureDays: number;
}

export interface ModelArtifact {
  modelVersion: string;
  featureNames: string[];
  coefficients: Record<string, number>;
  intercept: number;
  calibrationNote: string;
  trainingDataSize: number;
  trainingSplit: { trainDays: number; testDays: number };
}

export const LIQUIDITY_MODEL_V1: ModelArtifact = {
  modelVersion: "liquidity-logistic-v1-demo",
  featureNames: [
    "cashFlowVolatility",
    "daysRunwayTrend",
    "paymentTimingRegularity",
    "availableBalanceRatio",
    "supplierTenureDays",
  ],
  coefficients: {
    cashFlowVolatility: 2.1,
    daysRunwayTrend: -3.5,
    paymentTimingRegularity: -1.8,
    availableBalanceRatio: -2.9,
    supplierTenureDays: -0.002,
  },
  intercept: 0.5,
  calibrationNote:
    "Trained on synthetic Indian marketplace data. For demo purposes only. Not validated against real transactions.",
  trainingDataSize: 180,
  trainingSplit: { trainDays: 24, testDays: 6 },
};

/**
 * Logistic sigmoid function
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Evaluate the model on a feature snapshot
 */
export function evaluateModel(
  features: FeatureSnapshot,
  model: ModelArtifact = LIQUIDITY_MODEL_V1
): number {
  let logit = model.intercept;

  for (const featureName of model.featureNames) {
    const featureValue = features[featureName as keyof FeatureSnapshot];
    const coefficient = model.coefficients[featureName];
    logit += coefficient * featureValue;
  }

  const probability = sigmoid(logit);
  return Math.min(Math.max(probability, 0), 1); // Clamp to [0, 1]
}

/**
 * Baseline rule: trigger if available balance ratio is below threshold
 */
export function baselineDecision(features: FeatureSnapshot): boolean {
  const BASELINE_BALANCE_THRESHOLD = 0.4;
  return features.availableBalanceRatio < BASELINE_BALANCE_THRESHOLD;
}

/**
 * Compare model vs baseline
 */
export interface ModelComparison {
  modelProbability: number;
  baselineTriggered: boolean;
  recommendation: "REVIEW" | "APPROVE" | "REJECT";
  reasoning: string;
}

export function compareModelToBaseline(
  features: FeatureSnapshot,
  minProbabilityForApproval: number = 0.65
): ModelComparison {
  const modelProbability = evaluateModel(features);
  const baselineTriggered = baselineDecision(features);

  let recommendation: "REVIEW" | "APPROVE" | "REJECT";
  let reasoning: string;

  if (baselineTriggered && modelProbability >= minProbabilityForApproval) {
    recommendation = "APPROVE";
    reasoning =
      "Baseline triggered AND model probability strong; liquidity opportunity likely";
  } else if (
    !baselineTriggered &&
    modelProbability >= minProbabilityForApproval
  ) {
    recommendation = "REVIEW";
    reasoning =
      "Model indicates opportunity despite baseline not triggered; manual review recommended";
  } else if (modelProbability < minProbabilityForApproval) {
    recommendation = "REJECT";
    reasoning =
      "Model probability below threshold; insufficient evidence of liquidity stress";
  } else {
    recommendation = "REJECT";
    reasoning = "Default rejection; criteria not met";
  }

  return {
    modelProbability,
    baselineTriggered,
    recommendation,
    reasoning,
  };
}
