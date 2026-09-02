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
 */
interface SimulatedSupplier {
  features: Features;
  /** Ground truth: did the balance go negative within 7 days? */
  label: number;
  /** Kept for reporting only. */
  daysRunway: number;
}

function simulateSupplier(): SimulatedSupplier {
  // Latent business characteristics.
  const dailyOutflow = Math.exp(normal(Math.log(40000), 0.6)); // paise/day
  const balance = Math.exp(normal(Math.log(dailyOutflow * 8), 1.0));
  const paymentRegularity = clamp(normal(0.78, 0.16), 0.15, 0.99);
  const volatility = clamp(normal(0.22, 0.12), 0.02, 0.95);
  const tenureDays = clamp(Math.round(Math.exp(normal(Math.log(600), 0.9))), 30, 3000);

  // Expected receivables over the next 7 days, discounted by how reliably
  // this supplier's customers actually pay on time.
  const expectedInflowPerDay = dailyOutflow * clamp(normal(1.02, 0.25), 0.4, 1.8);

  // Forward simulate 7 days to derive the ground-truth label.
  let runningBalance = balance;
  let wentNegative = false;
  for (let day = 0; day < 7; day++) {
    const inflowArrives = rng() < paymentRegularity;
    const inflow = inflowArrives
      ? expectedInflowPerDay * clamp(normal(1, volatility), 0, 3)
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

  return { features, label: wentNegative ? 1 : 0, daysRunway };
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

  console.log("Fitting logistic regression…");
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
    calibrationNote:
      "Fitted on synthetic cash-flow simulations, not on real supplier data. " +
      "The generating process is a deliberate simplification: seven-day forward " +
      "simulation with independent daily draws. Treat the probabilities as " +
      "ordinal risk scores for demonstration, not as calibrated default rates. " +
      "Any production use requires refitting on real observations, fairness " +
      "review across supplier segments, and ongoing drift monitoring.",
    limitations: [
      "Trained on generated data; no real supplier ever entered this model.",
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

  if (testMetrics.auc < baselineMetrics.auc) {
    console.error(
      "\nThe model did not beat the baseline on held-out AUC. Not shipping this."
    );
    process.exit(1);
  }

  console.log("Model beats the baseline rule on held-out AUC.");
}

main();
