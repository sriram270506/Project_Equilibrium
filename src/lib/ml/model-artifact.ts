import generated from "./model-artifact.generated.json";

/**
 * Liquidity model artifact.
 *
 * The coefficients below are NOT hand-written. They are fitted by
 * `npm run ml:train` (scripts/train-model.ts) against a synthetic cash-flow
 * simulation with a held-out test split, and loaded from the generated JSON so
 * that the numbers the app scores with are exactly the numbers that were
 * evaluated.
 *
 * An earlier hand-specified version of this file had a feature and its
 * coefficient double-negated, so more cash runway predicted more distress and
 * every supplier scored 99%. Fitting the model made that impossible: a training
 * loop cannot learn a sign that contradicts its own data.
 */

export interface FeatureSnapshot {
  /** How much this supplier's cash flow swings week to week, 0-1. */
  cashFlowVolatility: number;
  /** Urgency: 1 when out of cash today, 0 at two weeks of cover or more. */
  runwayPressure: number;
  /** Higher when their customers pay erratically, 0-1. */
  paymentIrregularity: number;
  /** Cash on hand against a week of outflow, normalised 0-1. */
  balanceCoverage: number;
  /** Relationship length in years, normalised 0-1 over a five-year span. */
  tenureYears: number;
}

export interface ModelMetrics {
  auc: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  baseRate: number;
  threshold: number;
}

export interface ModelArtifact {
  modelVersion: string;
  trainedAt: string;
  featureNames: string[];
  coefficients: Record<string, number>;
  intercept: number;
  approvalThreshold: number;
  training: {
    totalSamples: number;
    trainSamples: number;
    testSamples: number;
    iterations: number;
    finalTrainLoss: number;
    seed: number;
  };
  metrics: {
    train: ModelMetrics;
    test: ModelMetrics;
    baseline: ModelMetrics;
  };
  calibrationNote: string;
  limitations: string[];
}

export const LIQUIDITY_MODEL: ModelArtifact = generated as ModelArtifact;

/** Retained for older imports. */
export const LIQUIDITY_MODEL_V1 = LIQUIDITY_MODEL;

/** The threshold above which policy will consider making an offer. */
export const APPROVAL_THRESHOLD = LIQUIDITY_MODEL.approvalThreshold;

/** Numerically stable logistic sigmoid. */
export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Score a feature snapshot. Returns the probability that this supplier faces a
 * cash shortfall within seven days.
 */
export function evaluateModel(
  features: FeatureSnapshot,
  model: ModelArtifact = LIQUIDITY_MODEL
): number {
  let logit = model.intercept;

  for (const featureName of model.featureNames) {
    const featureValue = features[featureName as keyof FeatureSnapshot];
    const coefficient = model.coefficients[featureName];
    if (typeof featureValue !== "number" || Number.isNaN(featureValue)) {
      throw new Error(`Missing or invalid feature: ${featureName}`);
    }
    logit += coefficient * featureValue;
  }

  return Math.min(Math.max(sigmoid(logit), 0), 1);
}

/**
 * The rule the model has to beat: flag anyone with under a week of cash.
 * Kept so the console can show model and baseline side by side.
 */
export function baselineDecision(features: FeatureSnapshot): boolean {
  // runwayPressure crosses 0.5 at exactly seven days of runway.
  return features.runwayPressure > 0.5;
}

export interface ModelComparison {
  modelProbability: number;
  modelTriggered: boolean;
  baselineTriggered: boolean;
  agree: boolean;
  recommendation: "APPROVE" | "REVIEW" | "REJECT";
  reasoning: string;
}

/**
 * Compare the model against the baseline rule for a single supplier. Where they
 * disagree is exactly where a human should look.
 */
export function compareModelToBaseline(
  features: FeatureSnapshot,
  threshold: number = APPROVAL_THRESHOLD
): ModelComparison {
  const modelProbability = evaluateModel(features);
  const modelTriggered = modelProbability >= threshold;
  const baselineTriggered = baselineDecision(features);
  const agree = modelTriggered === baselineTriggered;

  let recommendation: ModelComparison["recommendation"];
  let reasoning: string;

  if (modelTriggered && baselineTriggered) {
    recommendation = "APPROVE";
    reasoning =
      "Both the model and the simple runway rule flag this supplier. High confidence.";
  } else if (modelTriggered && !baselineTriggered) {
    recommendation = "REVIEW";
    reasoning =
      "The model sees a shortfall the runway rule misses - typically erratic customer payments or high volatility rather than a low balance. Worth a human look.";
  } else if (!modelTriggered && baselineTriggered) {
    recommendation = "REVIEW";
    reasoning =
      "Runway looks short but the model is unconcerned, usually because incoming payments are reliable. Worth a human look.";
  } else {
    recommendation = "REJECT";
    reasoning = "Neither the model nor the runway rule indicates distress.";
  }

  return {
    modelProbability,
    modelTriggered,
    baselineTriggered,
    agree,
    recommendation,
    reasoning,
  };
}
