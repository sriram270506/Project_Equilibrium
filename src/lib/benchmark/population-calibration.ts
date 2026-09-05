/**
 * Calibrating the simulated supplier population against published figures.
 *
 * The model is trained on simulated suppliers, because the label it predicts —
 * "will this supplier's bank balance go negative within seven days" — requires
 * daily balance data per firm. That does not exist publicly for any market. It
 * is the most confidential figure a business holds. There is no dataset to
 * download, and any project claiming a real label for this is either using a
 * weak proxy or working under an NDA.
 *
 * What CAN be made real is the shape of the population. An earlier version of
 * the trainer drew from `normal(0.78, 0.16)` and `exp(normal(log(40000), 0.6))`
 * — numbers chosen by hand and defensible to nobody. This module replaces them
 * with parameters DERIVED from published statistics, and records which is
 * which.
 *
 * Every parameter below is tagged:
 *
 *   FITTED   — solved from cited published figures. If the figures are
 *              updated, the parameter moves with them.
 *   ASSUMED  — chosen by us because no published figure constrains it. Stated
 *              plainly so a reviewer can attack the assumption directly
 *              instead of having to find it.
 *
 * `calibrationReport()` re-derives the published statistics back out of the
 * simulated population, so the calibration is checkable rather than asserted.
 * `KNOWN_DIVERGENCES` records where the calibrated population disagrees with a
 * secondary published figure, rather than quietly tuning until it agrees.
 */

import type { SourcedFigure } from "./market-data";

/* ------------------------------------------------------ Published evidence */

/**
 * Recordent's Indian SME Receivables Report 2026 — the largest transaction
 * level measurement of Indian B2B payment behaviour we could find, covering
 * roughly 1.1 lakh MSMEs and over 10 lakh transactions. This is the primary
 * anchor: it measures agreed terms and realised collection separately, which
 * is exactly the gap the product exists to bridge.
 */
export const PAYMENT_BEHAVIOUR = {
  averageRealisedDays: {
    value: 73,
    label: "Average days an Indian MSME actually waits to be paid an invoice",
    source: "Recordent, Indian SME Receivables Report 2026",
    url: "https://smestreet.in/infocus/indian-smes-face-mounting-working-capital-stress-as-average-overdue-receivables-cross-383-crore-recordent-12111904",
    asOf: "2026-06-27",
  } satisfies SourcedFigure<number>,

  shareIssuedAtThirtyDaysOrLess: {
    value: 0.826,
    label: "Share of invoices issued with credit terms of 30 days or less",
    source: "Recordent, Indian SME Receivables Report 2026",
    url: "https://smestreet.in/infocus/indian-smes-face-mounting-working-capital-stress-as-average-overdue-receivables-cross-383-crore-recordent-12111904",
    asOf: "2026-06-27",
  } satisfies SourcedFigure<number>,

  modalCreditDays: {
    value: 30,
    label:
      "Modal credit period on an Indian B2B invoice, per the 82.6% issued at 30 days or less",
    source: "Recordent, Indian SME Receivables Report 2026",
    url: "https://smestreet.in/infocus/indian-smes-face-mounting-working-capital-stress-as-average-overdue-receivables-cross-383-crore-recordent-12111904",
    asOf: "2026-06-27",
  } satisfies SourcedFigure<number>,

  bestCityRealisedDays: {
    value: 59,
    label: "Average realised payment days in Mumbai, the best-performing hub",
    source: "Recordent, Indian SME Receivables Report 2026",
    url: "https://smestreet.in/infocus/indian-smes-face-mounting-working-capital-stress-as-average-overdue-receivables-cross-383-crore-recordent-12111904",
    asOf: "2026-06-27",
  } satisfies SourcedFigure<number>,

  shareOverdueNinetyPlusInHubs: {
    value: 0.52,
    label:
      "Share of B2B payments overdue by 90 days or more in major Indian hubs",
    source: "Recordent, reported via CXOToday",
    url: "https://cxotoday.com/media-coverage/alarming-payment-trends-52-of-b2b-payments-overdue-for-90-days-in-major-indian-hubs/",
    asOf: "2026-06-27",
  } satisfies SourcedFigure<number>,
} as const;

/**
 * The size distribution of the firms in question. Two published quantiles are
 * enough to pin a lognormal, which is why these two in particular are here.
 */
export const FIRM_SIZE = {
  shareUnderOneCroreTurnover: {
    value: 0.88,
    label: "Share of MSMEs with annual turnover below Rs 1 crore",
    source: "Udyam Registration data, Ministry of MSME",
    url: "https://www.dcmsme.gov.in/UDYAM_Publication_with_tables_final20220622.pdf",
    asOf: "2022-06-22",
  } satisfies SourcedFigure<number>,

  shareMicro: {
    value: 0.989,
    label:
      "Share of registered MSMEs classified micro — turnover at or below Rs 10 crore",
    source: "Year End Review 2025, Ministry of MSME (PIB)",
    url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2209712",
    asOf: "2025-12-17",
  } satisfies SourcedFigure<number>,

  microTurnoverCeilingRupees: {
    value: 10_00_00_000,
    label:
      "Turnover ceiling for micro classification under the definition effective 01.04.2025",
    source: "Union Budget 2025-26 revised MSME classification",
    url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2209712",
    asOf: "2025-04-01",
  } satisfies SourcedFigure<number>,

  oneCroreRupees: {
    value: 1_00_00_000,
    label: "Rs 1 crore, in rupees — the threshold the 88% figure is quoted at",
    source: "Definitional",
    url: "https://www.dcmsme.gov.in/UDYAM_Publication_with_tables_final20220622.pdf",
    asOf: "2022-06-22",
  } satisfies SourcedFigure<number>,
} as const;

/* -------------------------------------------------------- Normal quantiles */

/**
 * Inverse standard normal CDF (Acklam's rational approximation, |error| well
 * under 1e-9 across the usable range). Needed to solve a lognormal from two
 * published quantiles — without it the fit below would have to be a hardcoded
 * number, which is the exact problem this module exists to remove.
 */
export function probit(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`probit requires 0 < p < 1, got ${p}`);

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Standard normal CDF, via the complementary error function. */
export function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26, applied to erf.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/* --------------------------------------------------------- Fitted: size */

/**
 * Solve the lognormal turnover distribution from the two published quantiles.
 *
 *   ln(T) ~ N(mu, sigma), with
 *     P(T < 1 crore)  = 0.880
 *     P(T < 10 crore) = 0.989
 *
 * Two equations, two unknowns. Nothing is chosen here — change either
 * published figure and both parameters move.
 */
function fitTurnoverLognormal(): { logMean: number; logSd: number } {
  const lnLow = Math.log(FIRM_SIZE.oneCroreRupees.value);
  const lnHigh = Math.log(FIRM_SIZE.microTurnoverCeilingRupees.value);
  const zLow = probit(FIRM_SIZE.shareUnderOneCroreTurnover.value);
  const zHigh = probit(FIRM_SIZE.shareMicro.value);

  const logSd = (lnHigh - lnLow) / (zHigh - zLow);
  const logMean = lnLow - zLow * logSd;
  return { logMean, logSd };
}

export const TURNOVER_FIT = fitTurnoverLognormal();

/* --------------------------------------------- Fitted: collection efficiency */

/**
 * Spread of collection efficiency across firms, as a Beta concentration.
 *
 * ASSUMED. The published data gives a national average (73 days) and one city
 * average (59 days) — two means, which pin the centre but not the dispersion.
 * We cannot cite this. It is the single largest unverified choice in the
 * population and is called out in KNOWN_DIVERGENCES.
 */
export const COLLECTION_EFFICIENCY_CONCENTRATION = 6;

/**
 * Collection efficiency: the fraction of the receivable rate a supplier
 * realises, relative to being paid exactly on terms. A firm on 30-day terms
 * paid at day 73 has efficiency 30/73.
 *
 * The obvious calibration — set the mean efficiency to 30/73 = 0.411 — is
 * WRONG, and the population self-check caught it. The published figure is a
 * mean of DAYS, and days = terms / efficiency is convex in efficiency, so by
 * Jensen's inequality E[terms/p] > terms/E[p]. Centring the efficiency
 * distribution on 0.411 produced a population whose average realised cycle was
 * 98.6 days, not 73 — a full month of error, all of it invisible without the
 * check.
 *
 * Solved properly. For p ~ Beta(a, b) with a = mk and b = (1-m)k,
 *
 *   E[1/p] = (a + b - 1) / (a - 1) = (k - 1) / (mk - 1)
 *
 * Setting terms x E[1/p] equal to the published average and solving for m:
 *
 *   m = (1 + terms (k - 1) / realisedDays) / k
 *
 * Exact, not iterative, and it moves if either published figure changes.
 * Requires mk > 1, which holds comfortably here.
 */
function fitMeanCollectionEfficiency(): number {
  const terms = PAYMENT_BEHAVIOUR.modalCreditDays.value;
  const realised = PAYMENT_BEHAVIOUR.averageRealisedDays.value;
  const k = COLLECTION_EFFICIENCY_CONCENTRATION;

  const mean = (1 + (terms * (k - 1)) / realised) / k;

  if (mean * k <= 1) {
    throw new Error(
      `Beta shape a = ${(mean * k).toFixed(3)} must exceed 1 for E[1/p] to be ` +
        "finite. Raise COLLECTION_EFFICIENCY_CONCENTRATION."
    );
  }
  return mean;
}

export const MEAN_COLLECTION_EFFICIENCY = fitMeanCollectionEfficiency();

/* ------------------------------------------------------ Assumed parameters */

export interface AssumedParameter {
  value: number;
  label: string;
  /** Why this value, and what a reviewer should push on. */
  rationale: string;
}

export const ASSUMPTIONS = {
  /**
   * Turnover floor for a supplier to appear in our book at all. The national
   * distribution above is dominated by Udyam Assist registrations — informal
   * micro units that never invoice a large buyer on credit terms. Our
   * population is conditioned on holding a financeable invoice, so we sample
   * the national distribution truncated below this floor.
   */
  financeableTurnoverFloorRupees: {
    value: 6_00_000,
    label: "Minimum annual turnover for a supplier to hold a financeable invoice",
    rationale:
      "A firm turning over less than Rs 6 lakh a year does not issue the kind of invoice a marketplace advances against. Modelled as truncation rather than a shifted distribution, so the national fit stays intact and the selection effect is explicit. The floor also bounds the demo fixtures, which span Rs 6.5-15 lakh of turnover so that a seeded supplier is drawn from the same population the model was trained on. Push on this: it is the difference between our population and the Udyam universe.",
  } satisfies AssumedParameter,

  /** Cash outflow as a share of turnover — everything that is not net margin. */
  outflowShareOfTurnover: {
    value: 0.92,
    label: "Operating cash outflow as a fraction of turnover",
    rationale:
      "Implies an 8% net margin, typical for small Indian trading and light manufacturing but not measured here. A lower margin makes the population more distressed; this is a lever a reviewer should test.",
  } satisfies AssumedParameter,

  /** Day-to-day variability in receipts and payments. */
  cashFlowVolatilityMean: {
    value: 0.22,
    label: "Mean coefficient of variation of daily cash flow",
    rationale:
      "No public source measures daily cash-flow variance for Indian MSMEs. Retained from the original hand-set model precisely so the change in results is attributable to the calibrated parameters and not to this one.",
  } satisfies AssumedParameter,

  cashFlowVolatilitySd: {
    value: 0.12,
    label: "Spread of the cash-flow volatility parameter",
    rationale: "As above — unmeasured, retained unchanged for comparability.",
  } satisfies AssumedParameter,

  /** Buffer held, expressed in days of outflow. */
  medianBufferDays: {
    value: 8,
    label: "Median cash buffer held, in days of operating outflow",
    rationale:
      "Reflects the reality that a firm collecting at 41% efficiency cannot hold a large buffer, but is not itself published. Directly sets how many suppliers are already near the edge.",
  } satisfies AssumedParameter,

  tenureMedianDays: {
    value: 600,
    label: "Median length of the buyer-supplier relationship, in days",
    rationale:
      "Udyam records registration date, not trading relationship age, so this is unanchored. Tenure is the weakest feature in the model, so the cost of being wrong here is low.",
  } satisfies AssumedParameter,
} as const;

/* -------------------------------------------------- Honest disagreements */

export interface Divergence {
  figure: string;
  published: string;
  ours: string;
  explanation: string;
}

/**
 * Where the calibrated population does NOT reproduce a published figure.
 *
 * Recorded rather than tuned away. Fitting the primary anchor and then quietly
 * adjusting until every secondary statistic also matched would make the
 * calibration unfalsifiable — the population would agree with everything
 * because it had been forced to, not because the model was right.
 */
export const KNOWN_DIVERGENCES: Divergence[] = [
  {
    figure: "Share of B2B payments overdue 90+ days in major hubs",
    published: "52%",
    ours: "Materially lower at the fitted concentration",
    explanation:
      "The 52% figure is quoted for major metro hubs and counts payments, while the 73-day average is a national per-invoice mean. Reproducing both simultaneously is impossible with a single unimodal efficiency distribution: 52% of firms below 25% efficiency cannot coexist with a median of 41%. We anchor on the 73-day figure because it comes from the larger documented sample, and leave the disagreement visible.",
  },
  {
    figure: "Average overdue receivables per SME beyond 360 days",
    published: "Rs 3.83 crore",
    ours: "Not modelled",
    explanation:
      "Our horizon is 14 days and our unit is a single invoice, so a stock of very long-dated receivables has nowhere to land in this simulation. It would matter for a credit product; it does not change a seven-day shortfall prediction.",
  },
  {
    figure: "Firm size distribution",
    published: "88% below Rs 1 crore turnover",
    ours: "Higher, by construction",
    explanation:
      "We truncate below Rs 10 lakh turnover because a supplier must hold a financeable invoice to appear at all. The underlying distribution reproduces the published quantiles; the population we sample is deliberately a conditioned subset of it.",
  },
];

/* --------------------------------------------------------- Self-check */

export interface CalibrationCheck {
  statistic: string;
  published: number;
  simulated: number;
  toleranceAbs: number;
  passed: boolean;
}

/**
 * Re-derive the published statistics from a simulated population.
 *
 * This is what makes the word "calibrated" mean something. A population that
 * claims to match a 73-day payment cycle should produce a 73-day payment cycle
 * when you measure it, and if it stops doing so the test fails.
 */
export function calibrationReport(
  population: Array<{ collectionEfficiency: number; annualTurnoverRupees: number }>
): CalibrationCheck[] {
  if (population.length === 0) {
    throw new Error("Cannot check calibration against an empty population");
  }

  const meanEfficiency =
    population.reduce((s, p) => s + p.collectionEfficiency, 0) /
    population.length;

  // Efficiency is terms/realised, so realised days is terms/efficiency.
  // Averaged per firm, matching how the published mean is constructed.
  const meanRealisedDays =
    population.reduce(
      (s, p) =>
        s + PAYMENT_BEHAVIOUR.modalCreditDays.value / p.collectionEfficiency,
      0
    ) / population.length;

  const shareUnderOneCrore =
    population.filter(
      (p) => p.annualTurnoverRupees < FIRM_SIZE.oneCroreRupees.value
    ).length / population.length;

  return [
    {
      statistic: "Mean collection efficiency (terms / realised days)",
      published: MEAN_COLLECTION_EFFICIENCY,
      simulated: meanEfficiency,
      toleranceAbs: 0.02,
      passed: Math.abs(meanEfficiency - MEAN_COLLECTION_EFFICIENCY) <= 0.02,
    },
    {
      statistic: "Mean realised payment days",
      published: PAYMENT_BEHAVIOUR.averageRealisedDays.value,
      simulated: meanRealisedDays,
      // Wide: the harmonic-style mean of a ratio is not the ratio of means,
      // and a long right tail pulls this up. Directional agreement is the
      // claim, not three-significant-figure agreement.
      // Tight, because the Beta mean is solved analytically to hit this exact
      // figure. What is left is sampling noise plus the small downward pull of
      // clamping the efficiency tail. If this drifts, the generator changed.
      toleranceAbs: 6,
      passed:
        Math.abs(meanRealisedDays - PAYMENT_BEHAVIOUR.averageRealisedDays.value) <=
        6,
    },
    {
      statistic:
        "Share below Rs 1 crore turnover (after the financeable-invoice floor)",
      published: FIRM_SIZE.shareUnderOneCroreTurnover.value,
      simulated: shareUnderOneCrore,
      // Deliberately loose: we sample a truncated subset, so this is expected
      // to sit below the national figure. See KNOWN_DIVERGENCES.
      toleranceAbs: 0.25,
      passed:
        shareUnderOneCrore <= FIRM_SIZE.shareUnderOneCroreTurnover.value + 0.02,
    },
  ];
}

/** Everything above, flattened for an API response or a docs table. */
export function calibrationSnapshot() {
  return {
    anchors: {
      averageRealisedDays: PAYMENT_BEHAVIOUR.averageRealisedDays,
      modalCreditDays: PAYMENT_BEHAVIOUR.modalCreditDays,
      shareIssuedAtThirtyDaysOrLess:
        PAYMENT_BEHAVIOUR.shareIssuedAtThirtyDaysOrLess,
      shareUnderOneCroreTurnover: FIRM_SIZE.shareUnderOneCroreTurnover,
      shareMicro: FIRM_SIZE.shareMicro,
    },
    fitted: {
      meanCollectionEfficiency: MEAN_COLLECTION_EFFICIENCY,
      turnoverLogMean: TURNOVER_FIT.logMean,
      turnoverLogSd: TURNOVER_FIT.logSd,
      medianTurnoverRupees: Math.exp(TURNOVER_FIT.logMean),
    },
    assumed: ASSUMPTIONS,
    divergences: KNOWN_DIVERGENCES,
  };
}
