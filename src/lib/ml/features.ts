import { FeatureSnapshot } from "./model-artifact";

/**
 * Feature construction.
 *
 * Kept in one place, separate from both the model and the service, because
 * training-time and serving-time features MUST be computed identically. When
 * they drift apart you get a model that scores well offline and behaves
 * bizarrely in production - and it is very hard to see, because nothing errors.
 *
 * The conventions here mirror scripts/train-model.ts exactly:
 *   - every feature is normalised to roughly [0, 1]
 *   - higher always means "more distressed", except balanceCoverage and
 *     tenureYears where higher means safer
 */

export interface ObservationInput {
  availableBalancePaise: number;
  inflowPaise: number;
  outflowPaise: number;
  daysRunway: number;
  paymentRegularity: number;
  volatility: number;
}

/** Runway at which pressure reaches zero - two weeks of cover. */
export const RUNWAY_HORIZON_DAYS = 14;

/** Days of outflow that balanceCoverage is measured against. */
export const COVERAGE_WINDOW_DAYS = 7;

function clamp(value: number, lo: number, hi: number): number {
  if (Number.isNaN(value)) return lo;
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Build the model's feature vector from a supplier observation.
 *
 * `tenureDays` comes from the supplier record rather than the observation.
 */
export function buildFeatures(
  observation: ObservationInput,
  tenureDays: number
): FeatureSnapshot {
  // Daily outflow implied by the observation window.
  const dailyOutflow = Math.max(observation.outflowPaise, 1);

  return {
    cashFlowVolatility: clamp(observation.volatility, 0, 1),

    // 1 when out of cash today, 0 at two weeks of cover or more.
    runwayPressure: clamp(
      1 - observation.daysRunway / RUNWAY_HORIZON_DAYS,
      0,
      1
    ),

    // The model reasons about irregularity, not regularity.
    paymentIrregularity: clamp(1 - observation.paymentRegularity, 0, 1),

    // Cash on hand against a week of outflow, normalised so that two weeks of
    // cover saturates at 1.
    balanceCoverage: clamp(
      observation.availableBalancePaise /
        (dailyOutflow * COVERAGE_WINDOW_DAYS) /
        2,
      0,
      1
    ),

    // Five years of trading history saturates the feature.
    tenureYears: clamp(tenureDays / 365 / 5, 0, 1),
  };
}

/**
 * Days of runway implied by a feature snapshot. Used by the explainer to talk
 * about days rather than about a normalised pressure score.
 */
export function runwayDaysFromPressure(runwayPressure: number): number {
  return (1 - clamp(runwayPressure, 0, 1)) * RUNWAY_HORIZON_DAYS;
}
