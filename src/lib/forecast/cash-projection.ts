/**
 * Cash-flow projection.
 *
 * The point of this module is to replace "64% risk" with something an operator
 * can act on: a balance curve, the date it crosses zero, and what changes if we
 * intervene. A probability is a summary of a forecast; the forecast itself is
 * the thing that tells you *when* and *how much*.
 *
 * METHOD, STATED PLAINLY. This is a Monte Carlo simulation over the same
 * cash-flow structure the model was trained on, not a second model:
 *
 *   - Each day, an inflow arrives with probability `paymentRegularity`, at a
 *     magnitude drawn around the supplier's mean, scaled by their volatility.
 *   - Outflow is drawn around the daily mean with half that volatility, since
 *     costs are more predictable than receipts.
 *   - We run many paths and report the median plus a p10-p90 band.
 *
 * The band is the honest part. A single projected line implies a precision
 * nobody has; the spread is what tells an operator whether the shortfall is
 * near-certain or merely possible.
 */

export interface ProjectionInput {
  /** Cash on hand today, in paise. */
  openingBalancePaise: number;
  /** Mean daily outflow, in paise. */
  dailyOutflowPaise: number;
  /** Mean daily inflow when a payment actually arrives, in paise. */
  dailyInflowPaise: number;
  /** Probability a receipt arrives on any given day, 0-1. */
  paymentRegularity: number;
  /** Relative swing in daily cash flow, 0-1. */
  volatility: number;
  /** Days to project. */
  horizonDays?: number;
  /** Simulation paths. More is smoother and slower. */
  paths?: number;
  /** Fixed seed keeps the chart identical between renders. */
  seed?: number;
}

export interface ProjectionDay {
  day: number;
  /** Median balance across all paths, in paise. */
  medianPaise: number;
  /** 10th percentile - the pessimistic edge of the band. */
  p10Paise: number;
  /** 90th percentile - the optimistic edge. */
  p90Paise: number;
  /** Share of paths that are below zero on this day, 0-1. */
  shortfallProbability: number;
}

export interface CashProjection {
  days: ProjectionDay[];
  /** First day the MEDIAN path goes negative. Null if it never does. */
  medianZeroCrossingDay: number | null;
  /** First day ANY meaningful share of paths (>=10%) goes negative. */
  earliestRiskDay: number | null;
  /** Probability of at least one negative day across the horizon. */
  shortfallProbability: number;
  /** Deepest median shortfall, in paise. Zero if never negative. */
  worstMedianDeficitPaise: number;
  /** How much cash today would keep the median path positive throughout. */
  cashNeededPaise: number;
  horizonDays: number;
  paths: number;
}

/** Mulberry32 — small, fast, seedable, so a chart does not shimmer on re-render. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[index];
}

/**
 * Project a supplier's cash balance forward.
 *
 * Deterministic for a given seed: the same input always yields the same chart,
 * which matters when a reviewer re-runs a demo and expects to see the same
 * numbers they were just shown.
 */
export function projectCash(input: ProjectionInput): CashProjection {
  const {
    openingBalancePaise,
    dailyOutflowPaise,
    dailyInflowPaise,
    paymentRegularity,
    volatility,
    horizonDays = 14,
    paths = 400,
    seed = 42,
  } = input;

  const rng = makeRng(seed);

  // balances[day][path]
  const balancesByDay: number[][] = Array.from({ length: horizonDays }, () => []);
  let everNegativePaths = 0;

  for (let path = 0; path < paths; path++) {
    let balance = openingBalancePaise;
    let wentNegative = false;

    for (let day = 0; day < horizonDays; day++) {
      const receiptArrives = rng() < paymentRegularity;
      const inflowNoise = 1 + (rng() - 0.5) * 2 * volatility;
      const inflow = receiptArrives
        ? Math.max(0, dailyInflowPaise * inflowNoise)
        : 0;

      // Costs swing less than receipts do.
      const outflowNoise = 1 + (rng() - 0.5) * volatility;
      const outflow = Math.max(0, dailyOutflowPaise * outflowNoise);

      balance += inflow - outflow;
      if (balance < 0) wentNegative = true;

      balancesByDay[day].push(balance);
    }

    if (wentNegative) everNegativePaths++;
  }

  const days: ProjectionDay[] = balancesByDay.map((values, index) => {
    const sorted = [...values].sort((a, b) => a - b);
    const below = values.filter((v) => v < 0).length;
    return {
      day: index + 1,
      medianPaise: Math.round(percentile(sorted, 0.5)),
      p10Paise: Math.round(percentile(sorted, 0.1)),
      p90Paise: Math.round(percentile(sorted, 0.9)),
      shortfallProbability: below / values.length,
    };
  });

  const medianZeroCrossingDay =
    days.find((d) => d.medianPaise < 0)?.day ?? null;

  const earliestRiskDay =
    days.find((d) => d.shortfallProbability >= 0.1)?.day ?? null;

  const worstMedian = Math.min(...days.map((d) => d.medianPaise), 0);

  return {
    days,
    medianZeroCrossingDay,
    earliestRiskDay,
    shortfallProbability: everNegativePaths / paths,
    worstMedianDeficitPaise: worstMedian < 0 ? Math.abs(worstMedian) : 0,
    // Enough cash today to keep the median path above zero for the horizon.
    cashNeededPaise: worstMedian < 0 ? Math.abs(worstMedian) : 0,
    horizonDays,
    paths,
  };
}

export interface InterventionComparison {
  /** What happens if nobody does anything. */
  baseline: CashProjection;
  /** The same supplier, same seed, with the advance credited on day 1. */
  withAdvance: CashProjection;
  advancePaise: number;
  /** Days of runway bought by the advance. */
  runwayDaysGained: number;
  /** Did the intervention remove the median shortfall entirely? */
  shortfallAverted: boolean;
  /** Reduction in the probability of any shortfall, in percentage points. */
  riskReductionPoints: number;
}

/**
 * Run the same supplier twice — with and without the advance — on the SAME
 * seed, so the two curves differ only because of the intervention and not
 * because of different random draws.
 *
 * That detail matters: comparing two independently-seeded simulations would
 * attribute random variation to the intervention and overstate its effect.
 */
export function compareWithIntervention(
  input: ProjectionInput,
  advancePaise: number
): InterventionComparison {
  const seed = input.seed ?? 42;

  const baseline = projectCash({ ...input, seed });
  const withAdvance = projectCash({
    ...input,
    seed,
    openingBalancePaise: input.openingBalancePaise + advancePaise,
  });

  const baselineCrossing =
    baseline.medianZeroCrossingDay ?? baseline.horizonDays + 1;
  const advanceCrossing =
    withAdvance.medianZeroCrossingDay ?? withAdvance.horizonDays + 1;

  return {
    baseline,
    withAdvance,
    advancePaise,
    runwayDaysGained: advanceCrossing - baselineCrossing,
    shortfallAverted:
      baseline.medianZeroCrossingDay !== null &&
      withAdvance.medianZeroCrossingDay === null,
    riskReductionPoints: Math.round(
      (baseline.shortfallProbability - withAdvance.shortfallProbability) * 100
    ),
  };
}

/**
 * Build projection inputs from a stored liquidity observation.
 *
 * Kept here so the chart and the model read the same source rather than each
 * deriving their own idea of the supplier's cash shape.
 */
export function projectionInputFromObservation(observation: {
  availableBalancePaise: number;
  inflowPaise: number;
  outflowPaise: number;
  paymentRegularity: number;
  volatility: number;
}): ProjectionInput {
  return {
    openingBalancePaise: observation.availableBalancePaise,
    dailyOutflowPaise: observation.outflowPaise,
    // The stored inflow is what arrives ON a paying day, so it is not scaled
    // by regularity here - the simulation applies that as an arrival
    // probability instead. Multiplying twice would understate receipts badly.
    dailyInflowPaise: observation.inflowPaise,
    paymentRegularity: observation.paymentRegularity,
    volatility: observation.volatility,
  };
}
