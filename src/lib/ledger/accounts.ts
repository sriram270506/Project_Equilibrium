/**
 * Chart of accounts.
 *
 * Every account is declared here with its type, normal balance, and what it
 * actually means in this business. A reviewer should be able to look at any
 * journal entry and say why each leg exists.
 *
 * SCOPE, STATED PLAINLY. This is a single-entity, single-currency (INR),
 * cash-basis journal covering one transaction type: an early payment to a
 * supplier. It is NOT a general ledger. Deliberately out of scope, and not
 * implemented anywhere in this codebase:
 *
 *   - multi-currency and FX revaluation
 *   - period close, trial-balance lock, or year-end rollover
 *   - tax (GST/TDS) computation or reporting
 *   - intercompany or consolidation accounts
 *   - accrual-basis recognition and deferred revenue
 *   - statutory chart-of-accounts mapping for any jurisdiction
 *
 * Those are real requirements for a production finance system. Claiming them
 * here would be false; the trial balance proves internal consistency, not
 * accounting compliance.
 */

export type AccountType = "ASSET" | "LIABILITY" | "EXPENSE" | "INCOME";
export type NormalBalance = "DEBIT" | "CREDIT";

export interface AccountDefinition {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  /** What this account represents, in the language a finance operator uses. */
  meaning: string;
}

/**
 * Assets and expenses increase with debits; liabilities and income increase
 * with credits. That convention is what makes the trial balance meaningful
 * rather than an arbitrary equality check.
 */
export const CHART_OF_ACCOUNTS: Record<string, AccountDefinition> = {
  PLATFORM_CASH: {
    code: "PLATFORM_CASH",
    name: "Platform cash",
    type: "ASSET",
    normalBalance: "DEBIT",
    meaning:
      "The platform's own funds, used to advance money to suppliers ahead of the invoice due date.",
  },
  SUPPLIER_RECEIVABLE: {
    code: "SUPPLIER_RECEIVABLE",
    name: "Receivable from supplier",
    type: "ASSET",
    normalBalance: "DEBIT",
    meaning:
      "The face value the platform will recover from the buyer's payment on the original due date. This is the asset acquired in exchange for advancing cash.",
  },
  SUPPLIER_PAYABLE: {
    code: "SUPPLIER_PAYABLE",
    name: "Payable to supplier",
    type: "LIABILITY",
    normalBalance: "CREDIT",
    meaning:
      "Amount owed to the supplier between the decision to pay and the money actually leaving. Cleared when the provider confirms.",
  },
  PROVIDER_CLEARING: {
    code: "PROVIDER_CLEARING",
    name: "Provider clearing",
    type: "ASSET",
    normalBalance: "DEBIT",
    meaning:
      "Funds in transit at the payment provider: instructed but not yet confirmed settled. This is where money sits during an UNKNOWN outcome.",
  },
  DISCOUNT_INCOME: {
    code: "DISCOUNT_INCOME",
    name: "Early payment discount earned",
    type: "INCOME",
    normalBalance: "CREDIT",
    meaning:
      "The platform's gross earning on the advance - the difference between the invoice face value and what the supplier accepted today.",
  },
  PROVIDER_FEE_EXPENSE: {
    code: "PROVIDER_FEE_EXPENSE",
    name: "Payment provider fees",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    meaning:
      "What the payment provider charges to move the money. A real cost of every disbursement, and the reason gross earning is not margin.",
  },
  FUNDING_COST_EXPENSE: {
    code: "FUNDING_COST_EXPENSE",
    name: "Cost of capital",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    meaning:
      "What it costs the platform to have its own money tied up for the days between the advance and the due date.",
  },
  REFUND_RESERVE: {
    code: "REFUND_RESERVE",
    name: "Reversal reserve",
    type: "LIABILITY",
    normalBalance: "CREDIT",
    meaning:
      "Held against advances that may be reversed - a disputed invoice, a cancelled order, or a failed recovery.",
  },
};

export function accountDefinition(code: string): AccountDefinition | null {
  return CHART_OF_ACCOUNTS[code] ?? null;
}

/** Provider fee assumption, in basis points of the amount moved. */
export const PROVIDER_FEE_BPS = 25; // 0.25%, a typical payout fee

export interface JournalLeg {
  accountCode: string;
  debitPaise: number;
  creditPaise: number;
  /** Why this leg exists. Stored so the entry is self-explaining later. */
  memo: string;
}

export class UnbalancedJournalError extends Error {
  constructor(
    public readonly debits: number,
    public readonly credits: number,
    public readonly legs: JournalLeg[]
  ) {
    super(
      `Journal does not balance: ${debits} paise of debits against ${credits} of credits (difference ${debits - credits}).`
    );
    this.name = "UnbalancedJournalError";
  }
}

/**
 * Validate a set of legs before it is written.
 *
 * This is the service-boundary guard: an unbalanced journal must be impossible
 * to persist, not merely detectable afterwards by a report. Checking only in
 * the trial balance means the corruption is already committed by the time
 * anyone notices.
 */
export function assertJournalBalanced(legs: JournalLeg[]): void {
  if (legs.length < 2) {
    throw new UnbalancedJournalError(0, 0, legs);
  }

  let debits = 0;
  let credits = 0;

  for (const leg of legs) {
    if (!Number.isInteger(leg.debitPaise) || !Number.isInteger(leg.creditPaise)) {
      throw new Error(
        `Journal leg for ${leg.accountCode} has a non-integer amount. Money is always integer paise.`
      );
    }
    if (leg.debitPaise < 0 || leg.creditPaise < 0) {
      throw new Error(
        `Journal leg for ${leg.accountCode} has a negative amount. Use the opposite side instead.`
      );
    }
    if (leg.debitPaise > 0 && leg.creditPaise > 0) {
      throw new Error(
        `Journal leg for ${leg.accountCode} is both a debit and a credit. Split it into two legs.`
      );
    }
    if (!accountDefinition(leg.accountCode)) {
      throw new Error(
        `Unknown account code "${leg.accountCode}". Add it to the chart of accounts first.`
      );
    }

    debits += leg.debitPaise;
    credits += leg.creditPaise;
  }

  if (debits !== credits) {
    throw new UnbalancedJournalError(debits, credits, legs);
  }
}

export interface EarlyPaymentJournalInput {
  /** What the supplier is owed on the original due date. */
  faceValuePaise: number;
  /** What the supplier accepts to be paid today. */
  advancePaise: number;
  /** Days between the advance and the original due date. */
  daysEarly: number;
  /** Platform's annualised cost of capital, bps. */
  fundingCostBps?: number;
  /** Provider's fee, bps of the amount moved. */
  providerFeeBps?: number;
}

/**
 * The journal for one early payment.
 *
 * The economics, as entries rather than as prose:
 *
 *   The platform acquires the right to the full invoice (an asset) and gives up
 *   less cash than the invoice is worth. The difference is income. Moving the
 *   money costs a provider fee, and having the cash tied up costs funding.
 *
 *   Dr  Receivable from supplier        face value
 *       Cr  Payable to supplier                    advance
 *       Cr  Early payment discount earned          face - advance
 *
 *   Dr  Payment provider fees           fee
 *   Dr  Cost of capital                 funding
 *       Cr  Platform cash                          fee + funding
 *
 * The previous implementation posted a single Dr PLATFORM_CASH / Cr
 * SUPPLIER_PAYABLE pair. It balanced, but it recorded no income, no fee, no
 * funding cost, and it debited cash - the wrong direction for money going out.
 * Balanced is not the same as correct.
 */
export function buildEarlyPaymentJournal(
  input: EarlyPaymentJournalInput
): JournalLeg[] {
  const {
    faceValuePaise,
    advancePaise,
    daysEarly,
    fundingCostBps = 800,
    providerFeeBps = PROVIDER_FEE_BPS,
  } = input;

  if (advancePaise > faceValuePaise) {
    throw new Error(
      "The advance cannot exceed the invoice face value - that would be a loss, not a discount."
    );
  }

  const discountPaise = faceValuePaise - advancePaise;
  const providerFeePaise = Math.round((advancePaise * providerFeeBps) / 10000);
  const fundingCostPaise = Math.round(
    (advancePaise * fundingCostBps * daysEarly) / (10000 * 365)
  );

  const legs: JournalLeg[] = [
    {
      accountCode: "SUPPLIER_RECEIVABLE",
      debitPaise: faceValuePaise,
      creditPaise: 0,
      memo: "Right to recover the full invoice on its original due date",
    },
    {
      accountCode: "SUPPLIER_PAYABLE",
      debitPaise: 0,
      creditPaise: advancePaise,
      memo: "Owed to the supplier until the provider confirms the payment",
    },
    {
      accountCode: "DISCOUNT_INCOME",
      debitPaise: 0,
      creditPaise: discountPaise,
      memo: "Discount earned for paying early",
    },
  ];

  if (providerFeePaise > 0 || fundingCostPaise > 0) {
    if (providerFeePaise > 0) {
      legs.push({
        accountCode: "PROVIDER_FEE_EXPENSE",
        debitPaise: providerFeePaise,
        creditPaise: 0,
        memo: `Provider fee at ${providerFeeBps} bps of the amount moved`,
      });
    }
    if (fundingCostPaise > 0) {
      legs.push({
        accountCode: "FUNDING_COST_EXPENSE",
        debitPaise: fundingCostPaise,
        creditPaise: 0,
        memo: `Cost of capital, ${fundingCostBps} bps annualised over ${daysEarly} days`,
      });
    }
    legs.push({
      accountCode: "PLATFORM_CASH",
      debitPaise: 0,
      creditPaise: providerFeePaise + fundingCostPaise,
      memo: "Cash consumed by fees and funding",
    });
  }

  assertJournalBalanced(legs);
  return legs;
}

/**
 * Settlement journal, posted when the provider confirms the money has moved.
 *
 * The payable is discharged and cash actually leaves. Keeping this separate
 * from the decision entry is what lets the books distinguish "we have committed
 * to pay" from "the money is gone".
 */
export function buildSettlementJournal(advancePaise: number): JournalLeg[] {
  const legs: JournalLeg[] = [
    {
      accountCode: "SUPPLIER_PAYABLE",
      debitPaise: advancePaise,
      creditPaise: 0,
      memo: "Discharging the obligation to the supplier",
    },
    {
      accountCode: "PLATFORM_CASH",
      debitPaise: 0,
      creditPaise: advancePaise,
      memo: "Cash paid out to the supplier",
    },
  ];

  assertJournalBalanced(legs);
  return legs;
}

/**
 * Reversal journal.
 *
 * Corrections are posted as new, opposite entries rather than by editing
 * history. An edited ledger cannot be audited: you can no longer tell what was
 * believed at the time, only what someone later decided it should have said.
 */
export function buildReversalJournal(original: JournalLeg[]): JournalLeg[] {
  const reversed = original.map((leg) => ({
    accountCode: leg.accountCode,
    debitPaise: leg.creditPaise,
    creditPaise: leg.debitPaise,
    memo: `Reversal of: ${leg.memo}`,
  }));

  assertJournalBalanced(reversed);
  return reversed;
}
