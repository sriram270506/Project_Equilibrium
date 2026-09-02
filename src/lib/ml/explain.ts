import {
  FeatureSnapshot,
  ModelArtifact,
  LIQUIDITY_MODEL,
  APPROVAL_THRESHOLD,
  evaluateModel,
} from "./model-artifact";
import { runwayDaysFromPressure, RUNWAY_HORIZON_DAYS } from "./features";

/**
 * Explainability for the liquidity model.
 *
 * A logistic regression is additive in log-odds, which means every prediction
 * decomposes exactly into per-feature contributions. That is the whole reason
 * this project uses one: an operator about to move real money can be shown
 * precisely why the model asked for it, and an auditor can be shown the same
 * thing six months later from the stored feature snapshot.
 *
 * Nothing here is a post-hoc approximation - no SHAP sampling, no surrogate
 * model. The contributions below sum to the exact logit.
 */

export interface FeatureContribution {
  feature: keyof FeatureSnapshot;
  label: string;
  value: number;
  /** The value rendered the way a finance operator would say it. */
  displayValue: string;
  coefficient: number;
  /** coefficient x value - the exact additive contribution to the logit. */
  contribution: number;
  direction: "increases" | "decreases";
  /** Share of total absolute movement, 0-1. Used for bar widths. */
  weight: number;
  /** One sentence an operator can read aloud. */
  narrative: string;
}

export interface PredictionExplanation {
  probability: number;
  logit: number;
  intercept: number;
  modelVersion: string;
  threshold: number;
  flagged: boolean;
  contributions: FeatureContribution[];
  topDriver: FeatureContribution | null;
  summary: string;
  counterfactual: string;
}

const FEATURE_LABELS: Record<keyof FeatureSnapshot, string> = {
  cashFlowVolatility: "Cash flow volatility",
  runwayPressure: "Cash runway",
  paymentIrregularity: "Customer payment reliability",
  balanceCoverage: "Cash on hand",
  tenureYears: "Relationship length",
};

function formatFeatureValue(
  feature: keyof FeatureSnapshot,
  value: number
): string {
  switch (feature) {
    case "runwayPressure": {
      const days = runwayDaysFromPressure(value);
      return days >= RUNWAY_HORIZON_DAYS
        ? `${RUNWAY_HORIZON_DAYS}+ days`
        : `${days.toFixed(1)} days`;
    }
    case "tenureYears":
      return `${(value * 5).toFixed(1)} years`;
    case "paymentIrregularity":
      return `${((1 - value) * 100).toFixed(0)}% on time`;
    case "balanceCoverage":
      return `${(value * 2 * 7).toFixed(1)} days of outflow`;
    case "cashFlowVolatility":
      return `${(value * 100).toFixed(0)}% swing`;
    default:
      return value.toFixed(2);
  }
}

function narrativeFor(
  feature: keyof FeatureSnapshot,
  value: number
): string {
  switch (feature) {
    case "runwayPressure": {
      const days = runwayDaysFromPressure(value);
      if (days < 3) {
        return `At the current burn rate they run out of cash in ${days.toFixed(1)} days. This is the acute signal.`;
      }
      if (days < 7) {
        return `They have ${days.toFixed(1)} days of cash left - under a week of cover.`;
      }
      return `They hold ${days >= RUNWAY_HORIZON_DAYS ? "two weeks or more" : `${days.toFixed(1)} days`} of cover, which is comfortable.`;
    }
    case "paymentIrregularity": {
      const onTime = (1 - value) * 100;
      return onTime < 60
        ? `Their customers pay on time only ${onTime.toFixed(0)}% of the time, so incoming cash cannot be relied on.`
        : `Their customers pay on time ${onTime.toFixed(0)}% of the time, so receivables are reasonably dependable.`;
    }
    case "balanceCoverage": {
      const days = value * 2 * 7;
      return days < 4
        ? `Cash on hand covers only ${days.toFixed(1)} days of outflow.`
        : `Cash on hand covers ${days.toFixed(1)} days of outflow.`;
    }
    case "cashFlowVolatility":
      return value > 0.35
        ? `Cash in and out swings by ${(value * 100).toFixed(0)}%, so a shortfall is hard for them to see coming.`
        : `Cash flow is fairly steady at ${(value * 100).toFixed(0)}% variation.`;
    case "tenureYears": {
      const years = value * 5;
      return years < 1
        ? `Only ${(years * 12).toFixed(0)} months of trading history, so there is little track record to lean on.`
        : `${years.toFixed(1)} years of trading history supports the assessment.`;
    }
    default:
      return "";
  }
}

/**
 * Decompose a prediction into exact per-feature contributions.
 */
export function explainPrediction(
  features: FeatureSnapshot,
  model: ModelArtifact = LIQUIDITY_MODEL,
  threshold: number = APPROVAL_THRESHOLD
): PredictionExplanation {
  const probability = evaluateModel(features, model);

  let logit = model.intercept;
  const raw: Array<{
    feature: keyof FeatureSnapshot;
    value: number;
    coefficient: number;
    contribution: number;
  }> = [];

  for (const name of model.featureNames) {
    const feature = name as keyof FeatureSnapshot;
    const value = features[feature];
    const coefficient = model.coefficients[name];
    const contribution = coefficient * value;
    logit += contribution;
    raw.push({ feature, value, coefficient, contribution });
  }

  const totalAbs =
    raw.reduce((sum, r) => sum + Math.abs(r.contribution), 0) || 1;

  const contributions: FeatureContribution[] = raw
    .map((r) => ({
      feature: r.feature,
      label: FEATURE_LABELS[r.feature],
      value: r.value,
      displayValue: formatFeatureValue(r.feature, r.value),
      coefficient: r.coefficient,
      contribution: r.contribution,
      direction: (r.contribution >= 0 ? "increases" : "decreases") as
        | "increases"
        | "decreases",
      weight: Math.abs(r.contribution) / totalAbs,
      narrative: narrativeFor(r.feature, r.value),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const topDriver = contributions[0] ?? null;
  const flagged = probability >= threshold;

  const summary = flagged
    ? `${(probability * 100).toFixed(0)}% likelihood of a cash shortfall within 7 days, above the ${(threshold * 100).toFixed(0)}% action threshold. The strongest signal is ${topDriver ? topDriver.label.toLowerCase() : "the overall profile"}.`
    : `${(probability * 100).toFixed(0)}% likelihood of a cash shortfall within 7 days, below the ${(threshold * 100).toFixed(0)}% action threshold, so no offer is made.`;

  return {
    probability,
    logit,
    intercept: model.intercept,
    modelVersion: model.modelVersion,
    threshold,
    flagged,
    contributions,
    topDriver,
    summary,
    counterfactual: buildCounterfactual(features, model, probability, threshold),
  };
}

/**
 * Find the smallest change in cash runway that would flip the decision.
 *
 * This is what an operator actually asks when they disagree with a
 * recommendation: "what would have to be different?" Runway is the lever they
 * can most easily reason about, so we sweep that one and hold the rest fixed.
 */
export function buildCounterfactual(
  features: FeatureSnapshot,
  model: ModelArtifact = LIQUIDITY_MODEL,
  currentProbability?: number,
  threshold: number = APPROVAL_THRESHOLD
): string {
  const probability = currentProbability ?? evaluateModel(features, model);
  const currentlyFlagged = probability >= threshold;
  const currentDays = runwayDaysFromPressure(features.runwayPressure);

  for (let days = 0; days <= RUNWAY_HORIZON_DAYS; days += 0.25) {
    const probe: FeatureSnapshot = {
      ...features,
      runwayPressure: Math.min(Math.max(1 - days / RUNWAY_HORIZON_DAYS, 0), 1),
    };
    const probeProbability = evaluateModel(probe, model);
    const probeFlagged = probeProbability >= threshold;

    if (probeFlagged !== currentlyFlagged) {
      return currentlyFlagged
        ? `If this supplier held ${days.toFixed(1)} days of runway instead of ${currentDays.toFixed(1)}, the score would fall to ${(probeProbability * 100).toFixed(0)}% and no offer would be made.`
        : `If runway fell to ${days.toFixed(1)} days from ${currentDays.toFixed(1)}, the score would rise to ${(probeProbability * 100).toFixed(0)}% and an offer would be recommended.`;
    }
  }

  return currentlyFlagged
    ? "Runway alone does not explain this flag - the signal comes from unreliable customer payments or thin cash cover, so changing runway would not clear it."
    : "Even with no cash runway at all, the rest of this supplier's profile is strong enough that no offer would be triggered.";
}
