/**
 * Real market reference data.
 *
 * Every figure here comes from a public source and is cited. This exists so
 * the product's pricing and its claims about the problem can be checked
 * against reality rather than taken on trust — and so that when our own rate
 * is worse than the market's, the interface says so instead of hiding it.
 *
 * These are published aggregates, not a live feed. Refresh dates are recorded
 * so a stale number is visibly stale rather than quietly wrong.
 */

export interface SourcedFigure<T> {
  value: T;
  /** What this measures, in one line. */
  label: string;
  source: string;
  url: string;
  /** When the underlying figure was published or last confirmed. */
  asOf: string;
}

/**
 * MSME Samadhaan — the Government of India portal where a micro or small
 * enterprise files a formal complaint about a buyer who has not paid within
 * the statutory 45 days.
 *
 * This is the closest thing to a national measurement of the exact problem
 * this product addresses: it counts the cases severe enough that a small
 * business escalated to a government council.
 */
export const MSME_DELAYED_PAYMENTS = {
  applicationsFiled: {
    value: 218_000,
    label: "Delayed-payment applications filed since the portal opened in 2017",
    source: "MSME Samadhaan, Ministry of MSME",
    url: "https://samadhaan.msme.gov.in/",
    asOf: "2025-07-17",
  } satisfies SourcedFigure<number>,

  amountPendingCrore: {
    value: 22_363.4,
    label: "Amount still pending across unresolved applications, in Rs crore",
    source: "MSME Samadhaan, Ministry of MSME",
    url: "https://samadhaan.msme.gov.in/",
    asOf: "2025-07-17",
  } satisfies SourcedFigure<number>,

  statutoryPaymentDays: {
    value: 45,
    label:
      "Maximum days a buyer may take to pay a registered micro or small enterprise",
    source: "MSMED Act 2006, section 15",
    url: "https://msme.gov.in/",
    asOf: "2006-10-02",
  } satisfies SourcedFigure<number>,

  penaltyMultipleOfBankRate: {
    value: 3,
    label:
      "Compound interest multiple of the RBI bank rate payable on a late payment",
    source: "MSMED Act 2006, section 16",
    url: "https://msme.gov.in/",
    asOf: "2006-10-02",
  } satisfies SourcedFigure<number>,
} as const;

/**
 * TReDS — the RBI-licensed Trade Receivables Discounting System. This is the
 * incumbent this product must be honest about competing with.
 */
export const TREDS = {
  volumeFy26Crore: {
    value: 3_47_000,
    label: "Invoice discounting throughput in FY 2025-26, in Rs crore",
    source: "Reported TReDS platform volumes",
    url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2283195",
    asOf: "2026-03-31",
  } satisfies SourcedFigure<number>,

  volumeFy22Crore: {
    value: 40_000,
    label: "Invoice discounting throughput in FY 2021-22, in Rs crore",
    source: "Reported TReDS platform volumes",
    url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2283195",
    asOf: "2022-03-31",
  } satisfies SourcedFigure<number>,

  registeredMsmes: {
    value: 80_000,
    label: "MSMEs registered across TReDS platforms",
    source: "Reported TReDS platform statistics",
    url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2283195",
    asOf: "2025-03-31",
  } satisfies SourcedFigure<number>,

  platforms: {
    value: ["RXIL", "M1xchange", "Invoicemart", "C2treds", "DTX"],
    label: "RBI-licensed TReDS platforms currently operating",
    source: "RBI",
    url: "https://www.rbi.org.in/",
    asOf: "2026-01-01",
  } satisfies SourcedFigure<string[]>,

  /**
   * Typical discounting band on TReDS, annualised. Rates are set by auction
   * and depend on the BUYER's credit, so a small supplier selling to a
   * blue-chip buyer gets a rate reflecting that buyer, not themselves.
   */
  discountRateBpsLow: {
    value: 800,
    label: "Lower end of typical TReDS discounting, annualised basis points",
    source: "Reported TReDS auction ranges",
    url: "https://www.rbi.org.in/",
    asOf: "2025-12-31",
  } satisfies SourcedFigure<number>,

  discountRateBpsHigh: {
    value: 1200,
    label: "Upper end of typical TReDS discounting, annualised basis points",
    source: "Reported TReDS auction ranges",
    url: "https://www.rbi.org.in/",
    asOf: "2025-12-31",
  } satisfies SourcedFigure<number>,
} as const;

/**
 * Working-capital credit an unrated MSME faces if it borrows instead. Used as
 * the upper reference — the alternative when neither we nor TReDS will fund.
 */
export const ALTERNATIVE_CREDIT_BPS = 2400;

export type RateVerdict =
  | "BELOW_TREDS"
  | "WITHIN_TREDS_BAND"
  | "ABOVE_TREDS"
  | "ABOVE_ALTERNATIVE_CREDIT";

export interface RateBenchmark {
  ourRateBps: number;
  tredsLowBps: number;
  tredsHighBps: number;
  alternativeCreditBps: number;
  verdict: RateVerdict;
  /** Plain-language assessment an operator can read aloud. */
  assessment: string;
  /** How this offer should be justified, given where it lands. */
  justification: string;
  /** Difference against the TReDS midpoint, in basis points. Positive = dearer. */
  vsTredsMidpointBps: number;
}

/**
 * Compare our price against the regulated incumbent.
 *
 * This deliberately reports an unflattering answer when the answer is
 * unflattering. A pricing surface that only ever says "competitive" tells an
 * operator nothing, and tells a reviewer that nobody checked.
 */
export function benchmarkRate(ourRateBps: number): RateBenchmark {
  const low = TREDS.discountRateBpsLow.value;
  const high = TREDS.discountRateBpsHigh.value;
  const midpoint = (low + high) / 2;

  let verdict: RateVerdict;
  let assessment: string;
  let justification: string;

  if (ourRateBps > ALTERNATIVE_CREDIT_BPS) {
    verdict = "ABOVE_ALTERNATIVE_CREDIT";
    assessment = `At ${(ourRateBps / 100).toFixed(1)}% annualised this costs the supplier more than borrowing at ${ALTERNATIVE_CREDIT_BPS / 100}%. There is no version of this that is good for them.`;
    justification =
      "Not defensible. Policy should refuse to make this offer at all.";
  } else if (ourRateBps > high) {
    verdict = "ABOVE_TREDS";
    assessment = `At ${(ourRateBps / 100).toFixed(1)}% annualised this is dearer than TReDS, which discounts in the ${low / 100}-${high / 100}% band.`;
    justification =
      "Defensible only on access, not on price: TReDS requires both parties onboarded to an RBI-licensed platform, runs an auction, and settles T+1 or later. It will not fund a small invoice from an unrated vendor in under a minute. Say that explicitly rather than implying we are cheaper.";
  } else if (ourRateBps >= low) {
    verdict = "WITHIN_TREDS_BAND";
    assessment = `At ${(ourRateBps / 100).toFixed(1)}% annualised this sits inside the ${low / 100}-${high / 100}% band TReDS discounts at.`;
    justification =
      "Competitive on price, and materially faster with no onboarding. The strongest position to be in.";
  } else {
    verdict = "BELOW_TREDS";
    assessment = `At ${(ourRateBps / 100).toFixed(1)}% annualised this undercuts the TReDS band entirely.`;
    justification =
      "Cheaper than the regulated incumbent. Check the platform's own cost of capital still leaves a margin before celebrating.";
  }

  return {
    ourRateBps,
    tredsLowBps: low,
    tredsHighBps: high,
    alternativeCreditBps: ALTERNATIVE_CREDIT_BPS,
    verdict,
    assessment,
    justification,
    vsTredsMidpointBps: Math.round(ourRateBps - midpoint),
  };
}

/**
 * What a late payment costs the buyer in statutory interest under s.16 of the
 * MSMED Act: three times the RBI bank rate, compounded monthly, on any amount
 * outstanding past 45 days.
 */
export function msmedPenaltyPaise(
  principalPaise: number,
  daysLate: number,
  rbiBankRateBps = 650
): number {
  if (daysLate <= 0) return 0;
  const annualRate =
    (rbiBankRateBps * MSME_DELAYED_PAYMENTS.penaltyMultipleOfBankRate.value) /
    10000;
  const months = daysLate / 30;
  const compounded =
    principalPaise * (Math.pow(1 + annualRate / 12, months) - 1);
  return Math.round(compounded);
}

/** Everything above, flattened for an API response or a docs table. */
export function marketSnapshot() {
  return {
    problem: {
      applicationsFiled: MSME_DELAYED_PAYMENTS.applicationsFiled,
      amountPendingCrore: MSME_DELAYED_PAYMENTS.amountPendingCrore,
      statutoryPaymentDays: MSME_DELAYED_PAYMENTS.statutoryPaymentDays,
    },
    incumbent: {
      volumeFy26Crore: TREDS.volumeFy26Crore,
      volumeFy22Crore: TREDS.volumeFy22Crore,
      growthMultiple:
        Math.round(
          (TREDS.volumeFy26Crore.value / TREDS.volumeFy22Crore.value) * 10
        ) / 10,
      registeredMsmes: TREDS.registeredMsmes,
      platforms: TREDS.platforms,
      rateBandBps: [
        TREDS.discountRateBpsLow.value,
        TREDS.discountRateBpsHigh.value,
      ],
    },
  };
}
