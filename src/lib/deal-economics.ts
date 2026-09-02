import { percentageOfPaise } from "./money";

/**
 * Dynamic discounting economics.
 *
 * The trade is simple and old: a supplier is owed a fixed sum on a fixed future
 * date. They would rather have slightly less money today than the full amount
 * in 27 days, because they have wages to pay this Friday. The platform holds
 * idle cash and would rather earn a return on it than leave it in a current
 * account.
 *
 * Both sides win, but only if the price is right - and "right" is an annualized
 * rate, not a headline percentage. A 1.2% discount for 27 days is not a 1.2%
 * return; it is roughly 16% annualized. Showing the discount alone is how
 * suppliers get quietly overcharged, so every surface in this app shows the
 * annualized figure next to it.
 */

export interface DealEconomics {
  /** What the supplier is contractually owed. */
  faceValuePaise: number;
  /** Days between paying early and the original due date. */
  daysEarly: number;
  /** The discount rate applied, in basis points (100 bps = 1%). */
  discountBps: number;
  /** The rupee value of the discount - the platform's gross earning. */
  discountPaise: number;
  /** What actually lands in the supplier's account today. */
  supplierReceivesPaise: number;
  /** Gross return to the platform for funding this early. */
  platformEarnsPaise: number;
  /** The discount expressed as an annualized rate, in basis points. */
  annualizedRateBps: number;
  /** Same figure as a percentage, for display. */
  annualizedRatePercent: number;
  /** Cost of the platform's own capital over the same window, in paise. */
  platformCostOfCapitalPaise: number;
  /** Platform earning net of its own funding cost. */
  netPlatformMarginPaise: number;
  /** What this saves the supplier versus their alternative funding. */
  supplierSavingsVsAlternativePaise: number;
  /** The alternative rate we compare against, in basis points. */
  alternativeFundingRateBps: number;
}

export interface DealEconomicsInput {
  faceValuePaise: number;
  daysEarly: number;
  discountBps: number;
  /** Platform's own annualized cost of capital, bps. Default 8%. */
  platformCostOfCapitalBps?: number;
  /**
   * What the supplier would otherwise pay for short-term money. Indian MSMEs
   * borrowing against receivables typically face 18-30% annualized; we use 24%
   * as a conservative midpoint for the comparison.
   */
  alternativeFundingRateBps?: number;
}

const DAYS_PER_YEAR = 365;

export const DEFAULT_PLATFORM_COST_OF_CAPITAL_BPS = 800; // 8% annualized
export const DEFAULT_ALTERNATIVE_FUNDING_RATE_BPS = 2400; // 24% annualized

/**
 * Compute both sides of the trade.
 *
 * Every amount stays in integer paise. The only division is for rate maths,
 * which is dimensionless.
 */
export function computeDealEconomics(
  input: DealEconomicsInput
): DealEconomics {
  const {
    faceValuePaise,
    daysEarly,
    discountBps,
    platformCostOfCapitalBps = DEFAULT_PLATFORM_COST_OF_CAPITAL_BPS,
    alternativeFundingRateBps = DEFAULT_ALTERNATIVE_FUNDING_RATE_BPS,
  } = input;

  if (!Number.isInteger(faceValuePaise) || faceValuePaise < 0) {
    throw new Error(`Invalid face value: ${faceValuePaise}`);
  }
  if (daysEarly < 0) {
    throw new Error(`Days early cannot be negative: ${daysEarly}`);
  }

  const discountPaise = percentageOfPaise(faceValuePaise, discountBps);
  const supplierReceivesPaise = faceValuePaise - discountPaise;

  // Annualize: a discount held for `daysEarly` scales to a full year.
  const annualizedRateBps =
    daysEarly > 0
      ? Math.round((discountBps * DAYS_PER_YEAR) / daysEarly)
      : 0;

  // The platform funds `supplierReceivesPaise` for `daysEarly` days.
  const platformCostOfCapitalPaise = Math.round(
    (supplierReceivesPaise * platformCostOfCapitalBps * daysEarly) /
      (10000 * DAYS_PER_YEAR)
  );

  // What the supplier would pay to borrow the same sum for the same window.
  const alternativeCostPaise = Math.round(
    (supplierReceivesPaise * alternativeFundingRateBps * daysEarly) /
      (10000 * DAYS_PER_YEAR)
  );

  return {
    faceValuePaise,
    daysEarly,
    discountBps,
    discountPaise,
    supplierReceivesPaise,
    platformEarnsPaise: discountPaise,
    annualizedRateBps,
    annualizedRatePercent: annualizedRateBps / 100,
    platformCostOfCapitalPaise,
    netPlatformMarginPaise: discountPaise - platformCostOfCapitalPaise,
    supplierSavingsVsAlternativePaise: alternativeCostPaise - discountPaise,
    alternativeFundingRateBps,
  };
}

/**
 * One sentence describing the trade, for headlines and the demo narration.
 */
export function describeDeal(deal: DealEconomics): string {
  const rupees = (paise: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(paise / 100);

  return (
    `Supplier receives ${rupees(deal.supplierReceivesPaise)} today instead of ` +
    `${rupees(deal.faceValuePaise)} in ${deal.daysEarly} days. ` +
    `The platform earns ${rupees(deal.platformEarnsPaise)}, an annualized ` +
    `${deal.annualizedRatePercent.toFixed(1)}%.`
  );
}

/**
 * Is this deal fair to the supplier? A deal priced above their alternative
 * funding cost is worse than a loan, and we should not offer it.
 */
export function isFairToSupplier(deal: DealEconomics): boolean {
  return deal.annualizedRateBps <= deal.alternativeFundingRateBps;
}
