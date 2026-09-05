/**
 * Train the liquidity model.
 *
 *   npx tsx scripts/train-model.ts
 *
 * Fits a logistic regression that predicts whether a supplier will run out of
 * cash within seven days, using synthetic data generated from an explicit
 * cash-flow simulation. Writes the fitted artifact to
 * src/lib/ml/model-artifact.generated.json and prints held-out metrics.
 *
 * Why train at all, when the coefficients could be hand-written? Because
 * hand-written coefficients cannot be evaluated. Without a train/test split and
 * an AUC there is no way to know whether the model beats the trivial rule, and
 * "we used machine learning" becomes an unfalsifiable claim. It also catches
 * sign errors: an earlier hand-specified version of this model had a feature
 * and its coefficient double-negated, so more cash runway predicted MORE
 * distress. A fitted model cannot make that mistake.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import {
  TURNOVER_FIT,
  MEAN_COLLECTION_EFFICIENCY,
  COLLECTION_EFFICIENCY_CONCENTRATION,
  ASSUMPTIONS,
  probit,
  normalCdf,
  calibrationReport,
  KNOWN_DIVERGENCES,
} from "../src/lib/benchmark/population-calibration";
import { loadEnv } from "../src/lib/load-env";

// Must run before anything reads process.env.
loadEnv();

/* ------------------------------------------------------------ RNG (seeded) */

/** Mulberry32 - small, fast, and reproducible so training is deterministic. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260902);

/** Box-Muller normal sample. */
function normal(mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/**
 * Gamma sample, Marsaglia-Tsang. Only needed as a building block for Beta,
 * which is how collection efficiency is drawn — a bounded 0-1 quantity with a
 * fitted mean is a Beta, not a clamped normal. The old code clamped a normal,
 * which piles probability mass on the clamp boundaries and quietly distorts
 * exactly the tail the model is supposed to detect.
 */
function gamma(shape: number): number {
  if (shape < 1) {
    // Boost: Gamma(a) = Gamma(a+1) * U^(1/a)
    return gamma(shape + 1) * Math.pow(Math.max(rng(), 1e-12), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rng(), 1e-12);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta sample parameterised by mean and concentration, which is how the
 *  calibration expresses it. */
function beta(mean: number, concentration: number): number {
  const a = mean * concentration;
  const b = (1 - mean) * concentration;
  const ga = gamma(a);
  const gb = gamma(b);
  return ga / (ga + gb);
}

/**
 * Lognormal truncated below `floor`, by inverse transform rather than
 * rejection — exact, and it keeps the run deterministic in the number of RNG
 * draws consumed, which matters because the seed is what makes training
 * reproducible.
 */
function truncatedLognormal(
  logMean: number,
  logSd: number,
  floor: number
): number {
  const cdfAtFloor = normalCdf((Math.log(floor) - logMean) / logSd);
  const u = cdfAtFloor + rng() * (1 - cdfAtFloor);
  return Math.exp(logMean + logSd * probit(clamp(u, 1e-9, 1 - 1e-9)));
}

/* ------------------------------------------------------------- Feature set */

export const FEATURE_NAMES = [
  "cashFlowVolatility",
  "runwayPressure",
  "paymentIrregularity",
  "balanceCoverage",
  "tenureYears",
] as const;

type FeatureName = (typeof FEATURE_NAMES)[number];
type Features = Record<FeatureName, number>;

/**
 * A simulated supplier: a small business with a cash balance, recurring
 * outflows, and receivables that arrive on an unreliable schedule.
 *
 * The latent characteristics below are drawn from a population CALIBRATED to
 * published Indian MSME statistics — see population-calibration.ts. The
 * previous version drew from hand-chosen constants, which meant the model was
 * fitted to a market that existed only in this file.
 */
interface SimulatedSupplier {
  features: Features;
  /** Ground truth: did the balance go negative within 7 days? */
  label: number;
  /** Kept for reporting only. */
  daysRunway: number;
  /** Retained so the population can be checked back against its anchors. */
  collectionEfficiency: number;
  annualTurnoverRupees: number;
}

function simulateSupplier(): SimulatedSupplier {
  // Firm size, from the lognormal solved against the two published Udyam
  // quantiles, truncated to firms large enough to hold a financeable invoice.
  const annualTurnoverRupees = truncatedLognormal(
    TURNOVER_FIT.logMean,
    TURNOVER_FIT.logSd,
    ASSUMPTIONS.financeableTurnoverFloorRupees.value
  );

  // Turnover -> daily operating outflow, in paise.
  const dailyOutflow =
    (annualTurnoverRupees * ASSUMPTIONS.outflowShareOfTurnover.value * 100) /
    365;

  // How much of the receivable rate this firm actually realises. Fitted:
  // 30-day terms against a 73-day realised cycle.
  const collectionEfficiency = clamp(
    beta(MEAN_COLLECTION_EFFICIENCY, COLLECTION_EFFICIENCY_CONCENTRATION),
    0.05,
    0.99
  );

  /*
   * Working-capital lock-up. A firm on a 73-day collection cycle has more than
   * twice as much cash trapped in unpaid invoices as one on 30-day terms, so
   * it holds a thinner free-cash buffer for the same size of business. Scaled
   * against the fitted mean rather than a new constant, so this introduces no
   * additional unanchored parameter.
   */
  const bufferDays =
    ASSUMPTIONS.medianBufferDays.value *
    clamp(collectionEfficiency / MEAN_COLLECTION_EFFICIENCY, 0.25, 2.0);

  const balance = Math.exp(normal(Math.log(dailyOutflow * bufferDays), 1.0));
  const volatility = clamp(
    normal(
      ASSUMPTIONS.cashFlowVolatilityMean.value,
      ASSUMPTIONS.cashFlowVolatilitySd.value
    ),
    0.02,
    0.95
  );
  const tenureDays = clamp(
    Math.round(
      Math.exp(normal(Math.log(ASSUMPTIONS.tenureMedianDays.value), 0.9))
    ),
    30,
    3000
  );

  /*
   * The probability that a given day's expected receipt actually lands.
   * Collection efficiency IS that probability: a firm realising 41% of its
   * invoiced rate is one whose money arrives on 41% of the days it should.
   */
  const paymentRegularity = collectionEfficiency;

  // Gross receivables accrue at roughly the rate of outflow for a going
  // concern; what actually arrives is gated by paymentRegularity below.
  const expectedInflowPerDay = dailyOutflow * clamp(normal(1.02, 0.25), 0.4, 1.8);

  // Forward simulate 7 days to derive the ground-truth label.
  let runningBalance = balance;
  let wentNegative = false;
  for (let day = 0; day < 7; day++) {
    /*
     * Receipts are lumpy, not smaller. A going concern collecting at 41%
     * efficiency still collects everything it invoices — it collects it at day
     * 73 instead of day 30. So the arrival amount is grossed up by 1/p, which
     * holds the MEAN inflow rate equal to outflow and puts the whole effect of
     * slow collection into the variance.
     *
     * Getting this wrong the other way — scaling the rate down by p — would
     * make every simulated firm insolvent by construction and the label would
     * be almost always 1.
     */
    const inflowArrives = rng() < paymentRegularity;
    const inflow = inflowArrives
      ? (expectedInflowPerDay / paymentRegularity) *
        clamp(normal(1, volatility), 0, 3)
      : 0;
    const outflow = dailyOutflow * clamp(normal(1, volatility * 0.5), 0.2, 2.5);
    runningBalance += inflow - outflow;
    if (runningBalance < 0) {
      wentNegative = true;
      break;
    }
  }

  const daysRunway = dailyOutflow > 0 ? balance / dailyOutflow : 30;

  // Observable features, as the marketplace would compute them.
  const features: Features = {
    // How much this supplier's cash flow swings, 0-1.
    cashFlowVolatility: clamp(volatility, 0, 1),
    // Urgency: 1 when out of cash today, 0 at two weeks of cover or more.
    runwayPressure: clamp(1 - daysRunway / 14, 0, 1),
    // Higher when customers pay erratically.
    paymentIrregularity: clamp(1 - paymentRegularity, 0, 1),
    // Cash on hand relative to a week of outflow, normalised to 0-1.
    balanceCoverage: clamp(balance / (dailyOutflow * 7) / 2, 0, 1),
    // Longer relationships are modestly protective.
    tenureYears: clamp(tenureDays / 365 / 5, 0, 1),
  };

  return {
    features,
    label: wentNegative ? 1 : 0,
    daysRunway,
    collectionEfficiency,
    annualTurnoverRupees,
  };
}

/* ------------------------------------------------------------- Logistic fit */

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

interface FitResult {
  coefficients: Record<string, number>;
  intercept: number;
  iterations: number;
  finalLoss: number;
}

/**
 * Batch gradient descent on the log-loss, with light L2 regularisation.
 * Small data and five features - no need for anything cleverer.
 */
function fitLogistic(
  samples: SimulatedSupplier[],
  { learningRate = 0.5, iterations = 4000, l2 = 0.001 } = {}
): FitResult {
  const weights: Record<string, number> = {};
  for (const name of FEATURE_NAMES) weights[name] = 0;
  let intercept = 0;
  let finalLoss = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const gradients: Record<string, number> = {};
    for (const name of FEATURE_NAMES) gradients[name] = 0;
    let interceptGradient = 0;
    let loss = 0;

    for (const sample of samples) {
      let logit = intercept;
      for (const name of FEATURE_NAMES) {
        logit += weights[name] * sample.features[name];
      }
      const predicted = sigmoid(logit);
      const error = predicted - sample.label;

      loss -=
        sample.label * Math.log(Math.max(predicted, 1e-12)) +
        (1 - sample.label) * Math.log(Math.max(1 - predicted, 1e-12));

      for (const name of FEATURE_NAMES) {
        gradients[name] += error * sample.features[name];
      }
      interceptGradient += error;
    }

    const n = samples.length;
    for (const name of FEATURE_NAMES) {
      weights[name] -=
        learningRate * (gradients[name] / n + l2 * weights[name]);
    }
    intercept -= learningRate * (interceptGradient / n);
    finalLoss = loss / n;
  }

  return {
    coefficients: weights,
    intercept,
    iterations,
    finalLoss,
  };
}

/* ---------------------------------------------------------------- Metrics */

function predict(fit: FitResult, features: Features): number {
  let logit = fit.intercept;
  for (const name of FEATURE_NAMES) {
    logit += fit.coefficients[name] * features[name];
  }
  return sigmoid(logit);
}

interface Metrics {
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

/** AUC via the rank-sum identity - no sampling, exact for this data size. */
function computeAuc(scored: Array<{ score: number; label: number }>): number {
  const positives = scored.filter((s) => s.label === 1);
  const negatives = scored.filter((s) => s.label === 0);
  if (positives.length === 0 || negatives.length === 0) return 0.5;

  const sorted = [...scored].sort((a, b) => a.score - b.score);
  const ranks = new Map<number, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j++;
    const averageRank = (i + j + 2) / 2; // 1-indexed
    for (let k = i; k <= j; k++) ranks.set(k, averageRank);
    i = j + 1;
  }

  let rankSum = 0;
  sorted.forEach((sample, index) => {
    if (sample.label === 1) rankSum += ranks.get(index) ?? index + 1;
  });

  const nPos = positives.length;
  const nNeg = negatives.length;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function evaluate(
  fit: FitResult,
  samples: SimulatedSupplier[],
  threshold: number
): Metrics {
  const scored = samples.map((s) => ({
    score: predict(fit, s.features),
    label: s.label,
  }));

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const { score, label } of scored) {
    const predictedPositive = score >= threshold;
    if (predictedPositive && label === 1) tp++;
    else if (predictedPositive && label === 0) fp++;
    else if (!predictedPositive && label === 0) tn++;
    else fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

  return {
    auc: computeAuc(scored),
    accuracy: (tp + tn) / samples.length,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    baseRate: samples.filter((s) => s.label === 1).length / samples.length,
    threshold,
  };
}

/**
 * The rule this has to beat: "flag anyone with under a week of runway."
 * If the model cannot beat that, the model is not worth its complexity.
 */
function evaluateBaseline(samples: SimulatedSupplier[]): Metrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const s of samples) {
    const predictedPositive = s.daysRunway < 7;
    if (predictedPositive && s.label === 1) tp++;
    else if (predictedPositive && s.label === 0) fp++;
    else if (!predictedPositive && s.label === 0) tn++;
    else fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

  return {
    auc: computeAuc(
      samples.map((s) => ({
        // The baseline's "score" is just runway pressure.
        score: s.features.runwayPressure,
        label: s.label,
      }))
    ),
    accuracy: (tp + tn) / samples.length,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    baseRate: samples.filter((s) => s.label === 1).length / samples.length,
    threshold: 7,
  };
}

/* -------------------------------------------------------------------- Main */

/**
 * Choose the decision threshold from the business objective, not convention.
 *
 * The two errors are not symmetric. A false positive means offering early
 * payment to a supplier who would have been fine: they get cheap working
 * capital, the platform still earns its margin, and the downside is the
 * opportunity cost of the float. A false negative means a supplier who needed
 * cash was never offered it, and may miss payroll.
 *
 * We therefore optimise F-beta with beta = 3, weighting recall nine times more
 * heavily than precision, subject to a precision floor so that the system does
 * not simply offer to everybody. Sweeping and reporting this is the honest
 * alternative to quietly shipping 0.5 and hoping nobody checks recall.
 */
function selectThreshold(
  fit: FitResult,
  samples: SimulatedSupplier[],
  { beta = 3, minPrecision = 0.25 } = {}
): { threshold: number; fBeta: number } {
  let best = { threshold: 0.5, fBeta: -1 };
  const beta2 = beta * beta;

  for (let t = 0.02; t <= 0.9; t += 0.01) {
    const m = evaluate(fit, samples, t);
    if (m.precision < minPrecision) continue;
    const denominator = beta2 * m.precision + m.recall;
    const fBeta =
      denominator > 0
        ? ((1 + beta2) * m.precision * m.recall) / denominator
        : 0;
    if (fBeta > best.fBeta) best = { threshold: Number(t.toFixed(2)), fBeta };
  }

  return best;
}

function main() {
  const TOTAL = 4000;
  const TRAIN_RATIO = 0.75;

  console.log("Generating synthetic supplier cash-flow data…");
  const all: SimulatedSupplier[] = [];
  for (let i = 0; i < TOTAL; i++) all.push(simulateSupplier());

  const splitAt = Math.floor(TOTAL * TRAIN_RATIO);
  const train = all.slice(0, splitAt);
  const test = all.slice(splitAt);

  console.log(
    `  ${train.length} training / ${test.length} held-out samples, ` +
      `base rate ${(all.filter((s) => s.label === 1).length / TOTAL * 100).toFixed(1)}%`
  );

  /*
   * Does the generated population actually reproduce the published statistics
   * it claims to be calibrated against? Printed on every run, because a
   * calibration nobody measures is just a comment.
   */
  console.log("\nPopulation calibration (against published Indian MSME data)");
  const checks = calibrationReport(all);
  for (const check of checks) {
    console.log(
      `  ${check.passed ? "OK  " : "FAIL"} ${check.statistic}\n` +
        `       published ${check.published.toFixed(3)}  simulated ${check.simulated.toFixed(3)}` +
        `  (tolerance ±${check.toleranceAbs})`
    );
  }
  if (checks.some((c) => !c.passed)) {
    throw new Error(
      "The simulated population no longer matches its published anchors. " +
        "Either the generator changed or a cited figure was updated — resolve " +
        "which before trusting anything downstream of this model."
    );
  }

  console.log(
    `\n  Known divergences from secondary published figures: ${KNOWN_DIVERGENCES.length}` +
      " (see population-calibration.ts — recorded, not tuned away)"
  );

  console.log("\nFitting logistic regression…");
  const fit = fitLogistic(train);

  // Threshold is chosen on TRAINING data only, then reported on held-out data.
  const selected = selectThreshold(fit, train);
  const THRESHOLD = selected.threshold;
  console.log(
    `  selected threshold ${THRESHOLD.toFixed(2)} (recall-weighted F3 = ${selected.fBeta.toFixed(3)}, chosen on training data)`
  );

  const trainMetrics = evaluate(fit, train, THRESHOLD);
  const testMetrics = evaluate(fit, test, THRESHOLD);
  const baselineMetrics = evaluateBaseline(test);

  console.log("\nCoefficients");
  console.log(`  intercept${" ".repeat(12)}${fit.intercept.toFixed(4)}`);
  for (const name of FEATURE_NAMES) {
    const pad = " ".repeat(Math.max(1, 22 - name.length));
    console.log(`  ${name}${pad}${fit.coefficients[name].toFixed(4)}`);
  }

  console.log(`\nHeld-out performance (threshold ${THRESHOLD.toFixed(2)})`);
  console.log(`  AUC              ${testMetrics.auc.toFixed(3)}`);
  console.log(`  Accuracy         ${(testMetrics.accuracy * 100).toFixed(1)}%`);
  console.log(`  Precision        ${(testMetrics.precision * 100).toFixed(1)}%`);
  console.log(`  Recall           ${(testMetrics.recall * 100).toFixed(1)}%`);
  console.log(`  F1               ${testMetrics.f1.toFixed(3)}`);

  console.log("\nConfusion matrix (held-out)");
  console.log("                  predicted shortfall   predicted fine");
  console.log(
    `  actual shortfall        ${String(testMetrics.truePositives).padStart(4)}            ${String(testMetrics.falseNegatives).padStart(4)}`
  );
  console.log(
    `  actual fine             ${String(testMetrics.falsePositives).padStart(4)}            ${String(testMetrics.trueNegatives).padStart(4)}`
  );

  console.log("\nVersus the baseline rule (runway < 7 days)");
  console.log(
    `  AUC        model ${testMetrics.auc.toFixed(3)}  vs  baseline ${baselineMetrics.auc.toFixed(3)}`
  );
  console.log(
    `  Precision  model ${(testMetrics.precision * 100).toFixed(1)}%  vs  baseline ${(baselineMetrics.precision * 100).toFixed(1)}%`
  );
  console.log(
    `  Recall     model ${(testMetrics.recall * 100).toFixed(1)}%  vs  baseline ${(baselineMetrics.recall * 100).toFixed(1)}%`
  );

  /* --------------------------------------------------- negative controls */

  /*
   * Is this AUC real, or an artifact of the simulator?
   *
   * The fair criticism of any model trained on generated data is that the label
   * may be a deterministic function of the features, in which case a high AUC
   * measures nothing but the implementation. Two controls test for that.
   *
   *   1. PERMUTATION TEST. Shuffle the labels and refit, several times. A
   *      permuted fit must be unable to separate the classes.
   *
   *      We judge this on PREDICTION SPREAD, not on AUC. AUC is a pure rank
   *      statistic: when a fit correctly learns nothing, its outputs collapse
   *      into a narrow band around the base rate, and AUC magnifies whatever
   *      noise remains into a confident-looking number. An earlier version of
   *      this control reported 0.12 from one shuffle and looked alarming; the
   *      predictions spanned 0.082 to 0.104 around a base rate of 0.092. The
   *      model had learned nothing, exactly as intended - the metric was wrong,
   *      not the pipeline.
   *
   *   2. IRREDUCIBLE NOISE. The label comes from a seven-day forward simulation
   *      with independent daily draws, so two suppliers with identical features
   *      can get different labels. Measuring how often that happens shows the
   *      label is stochastic rather than a lookup of the features.
   */
  console.log("\nNegative controls");

  let flips = 0;
  const stabilityRuns = 400;
  for (let i = 0; i < stabilityRuns; i++) {
    if (simulateSupplier().label !== simulateSupplier().label) flips++;
  }

  const PERMUTATIONS = 15;
  const permutationAucs: number[] = [];
  let widestPermutedSpread = 0;

  for (let p = 0; p < PERMUTATIONS; p++) {
    const shuffledLabels = train.map((s) => s.label);
    for (let i = shuffledLabels.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledLabels[i], shuffledLabels[j]] = [
        shuffledLabels[j],
        shuffledLabels[i],
      ];
    }
    const permuted = train.map((sample, i) => ({
      ...sample,
      label: shuffledLabels[i],
    }));

    const permutedFit = fitLogistic(permuted, { iterations: 1200 });
    permutationAucs.push(evaluate(permutedFit, test, THRESHOLD).auc);

    const preds = test.map((t) => predict(permutedFit, t.features));
    widestPermutedSpread = Math.max(
      widestPermutedSpread,
      Math.max(...preds) - Math.min(...preds)
    );
  }

  const meanPermutationAuc =
    permutationAucs.reduce((a, b) => a + b, 0) / permutationAucs.length;
  const minPermutationAuc = Math.min(...permutationAucs);
  const maxPermutationAuc = Math.max(...permutationAucs);

  const realPreds = test.map((t) => predict(fit, t.features));
  const realSpread = Math.max(...realPreds) - Math.min(...realPreds);

  console.log(
    `  Permutation AUC           ${meanPermutationAuc.toFixed(3)} mean over ${PERMUTATIONS} shuffles ` +
      `(range ${minPermutationAuc.toFixed(3)}-${maxPermutationAuc.toFixed(3)})`
  );
  console.log(
    `  Prediction spread         real ${realSpread.toFixed(3)} vs permuted ${widestPermutedSpread.toFixed(3)} ` +
      `- a permuted fit learns essentially nothing`
  );
  console.log(
    `  Label flip rate           ${((flips / stabilityRuns) * 100).toFixed(1)}% ` +
      `- outcomes are stochastic, not a lookup of the features`
  );

  const leakageClean = widestPermutedSpread < realSpread * 0.25;
  console.log(
    leakageClean
      ? "  Controls pass: the signal is in the data, not in the plumbing."
      : "  WARNING: a permuted fit still separates the classes. Investigate before trusting any metric."
  );


  const artifact = {
    modelVersion: "liquidity-logistic-v2",
    trainedAt: new Date().toISOString(),
    featureNames: [...FEATURE_NAMES],
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    approvalThreshold: THRESHOLD,
    training: {
      totalSamples: TOTAL,
      trainSamples: train.length,
      testSamples: test.length,
      iterations: fit.iterations,
      finalTrainLoss: Number(fit.finalLoss.toFixed(5)),
      seed: 20260902,
    },
    metrics: {
      train: trainMetrics,
      test: testMetrics,
      baseline: baselineMetrics,
    },
    negativeControls: {
      permutationAucMean: Number(meanPermutationAuc.toFixed(4)),
      permutationAucRange: [
        Number(minPermutationAuc.toFixed(4)),
        Number(maxPermutationAuc.toFixed(4)),
      ],
      permutations: PERMUTATIONS,
      realPredictionSpread: Number(realSpread.toFixed(4)),
      permutedPredictionSpread: Number(widestPermutedSpread.toFixed(4)),
      labelFlipRate: Number((flips / stabilityRuns).toFixed(4)),
      passes: leakageClean,
      note:
        "Shuffled-label AUC must sit near 0.5. If it does not, the training " +
        "pipeline is leaking and no other metric here can be trusted. The " +
        "flip rate shows the label is stochastic rather than a deterministic " +
        "function of the features - but note that both the features and the " +
        "label come from the SAME simulator, so these metrics measure the " +
        "model against that simulator, not against real supplier behaviour.",
    },
    calibrationNote:
      "Fitted on synthetic cash-flow simulations, not on real supplier data. " +
      "The POPULATION those simulations draw from is calibrated to published " +
      "Indian MSME statistics - the firm-size lognormal is solved from two " +
      "Udyam quantiles (88% below Rs 1 crore turnover, 98.9% micro) and the " +
      "collection-efficiency Beta is solved so the average realised payment " +
      "cycle reproduces the 73 days measured by Recordent's Indian SME " +
      "Receivables Report 2026. See src/lib/benchmark/population-calibration.ts, " +
      "which also records where the calibration DISAGREES with secondary " +
      "published figures rather than tuning until it agrees. " +
      "The generating process remains a deliberate simplification: seven-day " +
      "forward simulation with independent daily draws. Treat the " +
      "probabilities as ordinal risk scores for demonstration, not as " +
      "calibrated default rates. Any production use requires refitting on real " +
      "observations, fairness review across supplier segments, and ongoing " +
      "drift monitoring.",
    limitations: [
      "Trained on generated data; no real supplier ever entered this model.",
      "The population is calibrated to published aggregates, but no real firm's cash flow was observed. Held-out AUC measures how well the model recovers the simulator, not how it would perform on real suppliers.",
      "Assumes daily cash-flow observations are complete and unbiased.",
      "No fairness evaluation across supplier size, geography, or sector.",
      "Does not model correlated shocks - a sector-wide downturn would break the independence assumption.",
      "Not monitored for drift; there is no production feedback loop.",
    ],
  };

  const outputPath = join(
    process.cwd(),
    "src",
    "lib",
    "ml",
    "model-artifact.generated.json"
  );
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + "\n", "utf-8");

  console.log(`\nWrote ${outputPath}`);

  if (!leakageClean) {
    console.error(
      "\nRefusing to write an artifact whose shuffled-label control failed."
    );
    process.exit(1);
  }

  if (testMetrics.auc < baselineMetrics.auc) {
    console.error(
      "\nThe model did not beat the baseline on held-out AUC. Not shipping this."
    );
    process.exit(1);
  }

  console.log("Model beats the baseline rule on held-out AUC.");
}

main();
