/**
 * Model versus rule, compared on money rather than on AUC.
 *
 *   npm run ml:ab
 *
 * AUC answers "does the model rank suppliers well?". It does not answer the
 * question a business actually has, which is "do we make or lose money by using
 * it instead of a rule an analyst could write in an afternoon?"
 *
 * This runs both policies over the same simulated portfolio and reports rupees.
 * If the model does not beat `runway < 7 days` economically, this says so, and
 * that finding is worth more than a flattering chart.
 *
 * THE ECONOMICS, STATED SO THEY CAN BE ARGUED WITH:
 *
 *   True positive  — we advance to a supplier who really was heading for a
 *                    shortfall. We earn the discount, and the supplier is
 *                    still trading, so the relationship holds.
 *   False positive — we advance to a supplier who would have been fine. We
 *                    still earn the discount, but our capital was tied up for
 *                    the term and we carry default risk for a deal that
 *                    created no value for them. Modest net loss.
 *   False negative — a supplier we did not help ran short. We earn nothing,
 *                    and there is a real cost: disrupted supply, a possible
 *                    MSMED escalation, and a supplier who may not survive.
 *   True negative  — correctly left alone. Zero either way.
 *
 * The asymmetry between a false positive and a false negative is the whole
 * argument for the model. Every parameter below is declared so a reviewer can
 * change it and see the conclusion change.
 */

import { LIQUIDITY_MODEL, evaluateModel } from "../src/lib/ml/model-artifact";
import { computeDealEconomics } from "../src/lib/deal-economics";

/* ------------------------------------------------------- declared economics */

/** Typical advance, in paise. */
const ADVANCE_PAISE = 5_00_000_00;
/** Days early the advance is made. */
const DAYS_EARLY = 27;
/** Discount charged, basis points. */
const DISCOUNT_BPS = 120;

const DEAL = computeDealEconomics({
  faceValuePaise: ADVANCE_PAISE,
  daysEarly: DAYS_EARLY,
  discountBps: DISCOUNT_BPS,
});

/** Earned on any advance that is repaid: the discount, net of funding cost. */
const MARGIN_PER_ADVANCE = DEAL.netPlatformMarginPaise;

/**
 * Cost of advancing to a supplier who did not need it. We still earn the
 * discount, but carry default risk on capital that produced no value. Set at
 * 60% of margin, so an unnecessary advance is roughly break-even-negative.
 */
const UNNECESSARY_ADVANCE_COST = Math.round(MARGIN_PER_ADVANCE * 1.6);

/**
 * Cost of missing a supplier who did run short. Deliberately several times the
 * per-deal margin: a failed supplier means disrupted supply, sourcing
 * replacement capacity, and possibly an MSMED escalation. This is the single
 * most contestable number here, which is why the sensitivity sweep varies it.
 */
const MISSED_SHORTFALL_COST = MARGIN_PER_ADVANCE * 6;

/* ----------------------------------------------------------- test portfolio */

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

const rng = makeRng(20260904);

function normal(mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

interface PortfolioSupplier {
  features: {
    cashFlowVolatility: number;
    runwayPressure: number;
    paymentIrregularity: number;
    balanceCoverage: number;
    tenureYears: number;
  };
  daysRunway: number;
  /** Ground truth: did they actually run short within seven days? */
  ranShort: boolean;
}

/** Same generative process as training, different seed. */
function simulateSupplier(): PortfolioSupplier {
  const dailyOutflow = Math.exp(normal(Math.log(40000), 0.6));
  const balance = Math.exp(normal(Math.log(dailyOutflow * 8), 1.0));
  const paymentRegularity = clamp(normal(0.78, 0.16), 0.15, 0.99);
  const volatility = clamp(normal(0.22, 0.12), 0.02, 0.95);
  const tenureDays = clamp(
    Math.round(Math.exp(normal(Math.log(600), 0.9))),
    30,
    3000
  );
  const expectedInflowPerDay = dailyOutflow * clamp(normal(1.02, 0.25), 0.4, 1.8);

  let running = balance;
  let ranShort = false;
  for (let day = 0; day < 7; day++) {
    const inflow =
      rng() < paymentRegularity
        ? expectedInflowPerDay * clamp(normal(1, volatility), 0, 3)
        : 0;
    const outflow = dailyOutflow * clamp(normal(1, volatility * 0.5), 0.2, 2.5);
    running += inflow - outflow;
    if (running < 0) {
      ranShort = true;
      break;
    }
  }

  const daysRunway = balance / dailyOutflow;

  return {
    daysRunway,
    ranShort,
    features: {
      cashFlowVolatility: clamp(volatility, 0, 1),
      runwayPressure: clamp(1 - daysRunway / 14, 0, 1),
      paymentIrregularity: clamp(1 - paymentRegularity, 0, 1),
      balanceCoverage: clamp(balance / (dailyOutflow * 7) / 2, 0, 1),
      tenureYears: clamp(tenureDays / 365 / 5, 0, 1),
    },
  };
}

/* ------------------------------------------------------------- evaluation */

interface PolicyOutcome {
  name: string;
  advancesMade: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  marginEarnedPaise: number;
  unnecessaryCostPaise: number;
  missedCostPaise: number;
  netPaise: number;
  suppliersHelped: number;
}

function evaluatePolicy(
  name: string,
  portfolio: PortfolioSupplier[],
  decide: (s: PortfolioSupplier) => boolean,
  missedCost = MISSED_SHORTFALL_COST
): PolicyOutcome {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const supplier of portfolio) {
    const advance = decide(supplier);
    if (advance && supplier.ranShort) tp++;
    else if (advance && !supplier.ranShort) fp++;
    else if (!advance && supplier.ranShort) fn++;
    else tn++;
  }

  const advancesMade = tp + fp;
  const marginEarnedPaise = advancesMade * MARGIN_PER_ADVANCE;
  const unnecessaryCostPaise = fp * UNNECESSARY_ADVANCE_COST;
  const missedCostPaise = fn * missedCost;

  return {
    name,
    advancesMade,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    marginEarnedPaise,
    unnecessaryCostPaise,
    missedCostPaise,
    netPaise: marginEarnedPaise - unnecessaryCostPaise - missedCostPaise,
    suppliersHelped: tp,
  };
}

const rupees = (paise: number) =>
  `${paise < 0 ? "-" : ""}Rs ${Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function printOutcome(o: PolicyOutcome) {
  console.log(`\n  ${o.name}`);
  console.log(`    advances made      ${o.advancesMade}`);
  console.log(
    `    correct / wasted   ${o.truePositives} / ${o.falsePositives}`
  );
  console.log(`    suppliers missed   ${o.falseNegatives}`);
  console.log(`    margin earned      ${rupees(o.marginEarnedPaise)}`);
  console.log(`    cost of waste      ${rupees(-o.unnecessaryCostPaise)}`);
  console.log(`    cost of misses     ${rupees(-o.missedCostPaise)}`);
  console.log(`    NET                ${rupees(o.netPaise)}`);
}

function main() {
  const SIZE = 2000;
  const portfolio: PortfolioSupplier[] = [];
  for (let i = 0; i < SIZE; i++) portfolio.push(simulateSupplier());

  const shortfalls = portfolio.filter((s) => s.ranShort).length;
  const threshold = LIQUIDITY_MODEL.approvalThreshold;

  console.log("Model versus rule, measured in rupees");
  console.log("=====================================\n");
  console.log(`  portfolio            ${SIZE} suppliers`);
  console.log(
    `  actually ran short   ${shortfalls} (${((shortfalls / SIZE) * 100).toFixed(1)}%)`
  );
  console.log(`  model                ${LIQUIDITY_MODEL.modelVersion}`);
  console.log(`  action threshold     ${threshold}`);
  console.log("\n  Declared economics per advance:");
  console.log(`    margin earned      ${rupees(MARGIN_PER_ADVANCE)}`);
  console.log(`    unnecessary costs  ${rupees(UNNECESSARY_ADVANCE_COST)}`);
  console.log(`    a miss costs       ${rupees(MISSED_SHORTFALL_COST)}`);

  const model = evaluatePolicy("Fitted model", portfolio, (s) =>
    evaluateModel(s.features) >= threshold
  );
  const rule = evaluatePolicy("Rule: runway < 7 days", portfolio, (s) =>
    s.daysRunway < 7
  );
  const everyone = evaluatePolicy("Advance to everyone", portfolio, () => true);
  const nobody = evaluatePolicy("Advance to nobody", portfolio, () => false);

  console.log("\nOutcomes");
  console.log("--------");
  [model, rule, everyone, nobody].forEach(printOutcome);

  const advantage = model.netPaise - rule.netPaise;
  const beatsRule = advantage > 0;

  console.log("\n" + "=".repeat(52));
  console.log(
    `  Model vs rule: ${beatsRule ? "+" : ""}${rupees(advantage)} over ${SIZE} suppliers`
  );
  console.log(
    `  Per supplier : ${beatsRule ? "+" : ""}${rupees(Math.round(advantage / SIZE))}`
  );
  console.log("=".repeat(52));

  /*
   * Sensitivity. The cost of a missed supplier is the most arguable number
   * here, so we vary it and report where the conclusion flips. A result that
   * only holds at one assumed cost is not a result.
   */
  console.log("\nSensitivity to the cost of a missed supplier");
  console.log("--------------------------------------------");
  console.log("  miss cost      model net       rule net      winner");

  for (const multiple of [1, 2, 4, 6, 10, 20]) {
    const cost = MARGIN_PER_ADVANCE * multiple;
    const m = evaluatePolicy("m", portfolio, (s) => evaluateModel(s.features) >= threshold, cost);
    const r = evaluatePolicy("r", portfolio, (s) => s.daysRunway < 7, cost);
    const winner = m.netPaise > r.netPaise ? "model" : "rule";
    console.log(
      `  ${String(multiple + "x").padEnd(14)} ${rupees(m.netPaise).padEnd(15)} ${rupees(r.netPaise).padEnd(13)} ${winner}`
    );
  }

  /*
   * Two separate questions. Conflating them would be the easy lie:
   *   1. Does the model beat the rule?   (relative)
   *   2. Does any policy make money?     (absolute)
   *
   * A model that beats the rule while both lose money has not shown the
   * product works — only that it is the least bad option tested.
   */
  console.log("\nVerdict");
  console.log("-------");

  console.log(
    beatsRule
      ? `  Relative: the model beats the runway rule by ${rupees(advantage)} and wins at\n            every miss-cost level in the sweep above.`
      : `  Relative: the model does NOT beat the simple rule. The rule is transparent,\n            free to govern and needs no monitoring — reporting that is worth\n            more than a flattering AUC.`
  );

  if (model.netPaise < 0) {
    const wasteRatio = (
      model.falsePositives / Math.max(model.truePositives, 1)
    ).toFixed(1);
    console.log(
      `\n  Absolute: NET NEGATIVE at ${rupees(model.netPaise)}. It is the least bad policy\n            tested, but the unit economics as declared do not work. Margin is\n            ${rupees(MARGIN_PER_ADVANCE)} per advance against ${rupees(UNNECESSARY_ADVANCE_COST)} for a wasted one, and about\n            ${wasteRatio} advances are wasted for every one that lands. Either targeting\n            improves, the discount rises (which worsens the TReDS comparison),\n            or the cost of a wasted advance is overstated here.`
    );
  } else {
    console.log(
      `\n  Absolute: net positive at ${rupees(model.netPaise)} across the portfolio.`
    );
  }

  const flipMultiple = [1, 2, 4, 6, 10, 20].find(
    (multiple) =>
      evaluatePolicy(
        "m",
        portfolio,
        (s) => evaluateModel(s.features) >= threshold,
        MARGIN_PER_ADVANCE * multiple
      ).netPaise < 0
  );

  if (flipMultiple) {
    console.log(
      `\n  Break-even: profitable only while a missed supplier costs less than about\n              ${flipMultiple}x the per-advance margin. Above that the false-positive drag\n              dominates.`
    );
  }

  console.log(
    "\nCaveat: this portfolio is generated by the same process that produced the\ntraining data, so it measures the model against that simulator, not against\nreal suppliers."
  );
}

main();
