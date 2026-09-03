import { describe, it, expect } from "vitest";
import {
  buildEarlyPaymentJournal,
  buildSettlementJournal,
  buildReversalJournal,
  assertJournalBalanced,
  accountDefinition,
  CHART_OF_ACCOUNTS,
  UnbalancedJournalError,
  JournalLeg,
} from "./accounts";

const sum = (legs: JournalLeg[], side: "debitPaise" | "creditPaise") =>
  legs.reduce((total, leg) => total + leg[side], 0);

describe("Chart of accounts", () => {
  it("declares a type and normal balance for every account", () => {
    for (const account of Object.values(CHART_OF_ACCOUNTS)) {
      expect(account.type).toBeDefined();
      expect(["DEBIT", "CREDIT"]).toContain(account.normalBalance);
      expect(account.meaning.length).toBeGreaterThan(20);
    }
  });

  it("follows the debit/credit convention for each account type", () => {
    for (const account of Object.values(CHART_OF_ACCOUNTS)) {
      const expected =
        account.type === "ASSET" || account.type === "EXPENSE"
          ? "DEBIT"
          : "CREDIT";
      expect(account.normalBalance).toBe(expected);
    }
  });
});

describe("Journal validation", () => {
  it("rejects an unbalanced journal", () => {
    expect(() =>
      assertJournalBalanced([
        { accountCode: "PLATFORM_CASH", debitPaise: 100, creditPaise: 0, memo: "x" },
        { accountCode: "SUPPLIER_PAYABLE", debitPaise: 0, creditPaise: 99, memo: "y" },
      ])
    ).toThrow(UnbalancedJournalError);
  });

  it("rejects a single-legged journal", () => {
    expect(() =>
      assertJournalBalanced([
        { accountCode: "PLATFORM_CASH", debitPaise: 100, creditPaise: 0, memo: "x" },
      ])
    ).toThrow();
  });

  it("rejects a leg that is both debit and credit", () => {
    expect(() =>
      assertJournalBalanced([
        { accountCode: "PLATFORM_CASH", debitPaise: 50, creditPaise: 50, memo: "x" },
        { accountCode: "SUPPLIER_PAYABLE", debitPaise: 0, creditPaise: 0, memo: "y" },
      ])
    ).toThrow(/both a debit and a credit/);
  });

  it("rejects negative amounts", () => {
    expect(() =>
      assertJournalBalanced([
        { accountCode: "PLATFORM_CASH", debitPaise: -100, creditPaise: 0, memo: "x" },
        { accountCode: "SUPPLIER_PAYABLE", debitPaise: 0, creditPaise: -100, memo: "y" },
      ])
    ).toThrow(/negative/);
  });

  it("rejects non-integer paise", () => {
    expect(() =>
      assertJournalBalanced([
        { accountCode: "PLATFORM_CASH", debitPaise: 10.5, creditPaise: 0, memo: "x" },
        { accountCode: "SUPPLIER_PAYABLE", debitPaise: 0, creditPaise: 10.5, memo: "y" },
      ])
    ).toThrow(/non-integer/);
  });

  it("rejects an account that is not in the chart", () => {
    expect(() =>
      assertJournalBalanced([
        { accountCode: "MADE_UP_ACCOUNT", debitPaise: 100, creditPaise: 0, memo: "x" },
        { accountCode: "PLATFORM_CASH", debitPaise: 0, creditPaise: 100, memo: "y" },
      ])
    ).toThrow(/Unknown account code/);
  });
});

describe("Early payment journal", () => {
  const input = {
    faceValuePaise: 15000000, // Rs 1,50,000 invoice
    advancePaise: 14820000, // Rs 1,48,200 paid today
    daysEarly: 27,
  };

  it("balances", () => {
    const legs = buildEarlyPaymentJournal(input);
    expect(sum(legs, "debitPaise")).toBe(sum(legs, "creditPaise"));
  });

  it("records the discount as income, not as a cash movement", () => {
    const legs = buildEarlyPaymentJournal(input);
    const income = legs.find((l) => l.accountCode === "DISCOUNT_INCOME");

    expect(income).toBeDefined();
    expect(income!.creditPaise).toBe(180000); // Rs 1,800
    expect(income!.debitPaise).toBe(0);
  });

  it("recognises the receivable acquired in exchange for the advance", () => {
    const legs = buildEarlyPaymentJournal(input);
    const receivable = legs.find(
      (l) => l.accountCode === "SUPPLIER_RECEIVABLE"
    );
    expect(receivable!.debitPaise).toBe(input.faceValuePaise);
  });

  it("posts a provider fee as an expense", () => {
    const legs = buildEarlyPaymentJournal(input);
    const fee = legs.find((l) => l.accountCode === "PROVIDER_FEE_EXPENSE");
    expect(fee).toBeDefined();
    expect(fee!.debitPaise).toBeGreaterThan(0);
  });

  it("posts the cost of capital, scaled by how long the money is out", () => {
    const short = buildEarlyPaymentJournal({ ...input, daysEarly: 5 });
    const long = buildEarlyPaymentJournal({ ...input, daysEarly: 90 });

    const cost = (legs: JournalLeg[]) =>
      legs.find((l) => l.accountCode === "FUNDING_COST_EXPENSE")?.debitPaise ?? 0;

    expect(cost(long)).toBeGreaterThan(cost(short));
  });

  it("refuses an advance larger than the invoice", () => {
    expect(() =>
      buildEarlyPaymentJournal({
        faceValuePaise: 100000,
        advancePaise: 150000,
        daysEarly: 10,
      })
    ).toThrow(/cannot exceed/);
  });

  it("gives every leg a memo explaining why it exists", () => {
    for (const leg of buildEarlyPaymentJournal(input)) {
      expect(leg.memo.length).toBeGreaterThan(10);
      expect(accountDefinition(leg.accountCode)).not.toBeNull();
    }
  });
});

describe("Settlement journal", () => {
  it("discharges the payable and moves cash out", () => {
    const legs = buildSettlementJournal(14820000);

    const payable = legs.find((l) => l.accountCode === "SUPPLIER_PAYABLE");
    const cash = legs.find((l) => l.accountCode === "PLATFORM_CASH");

    expect(payable!.debitPaise).toBe(14820000);
    // Cash is CREDITED when money leaves. The original implementation debited
    // it, which recorded a payout as though cash had increased.
    expect(cash!.creditPaise).toBe(14820000);
    expect(sum(legs, "debitPaise")).toBe(sum(legs, "creditPaise"));
  });
});

describe("Reversal journal", () => {
  it("mirrors every leg of the original", () => {
    const original = buildEarlyPaymentJournal({
      faceValuePaise: 15000000,
      advancePaise: 14820000,
      daysEarly: 27,
    });
    const reversal = buildReversalJournal(original);

    expect(reversal).toHaveLength(original.length);
    expect(sum(reversal, "debitPaise")).toBe(sum(original, "creditPaise"));
    expect(sum(reversal, "creditPaise")).toBe(sum(original, "debitPaise"));
  });

  it("leaves a net zero position when applied on top of the original", () => {
    const original = buildSettlementJournal(500000);
    const reversal = buildReversalJournal(original);
    const combined = [...original, ...reversal];

    for (const code of new Set(combined.map((l) => l.accountCode))) {
      const net = combined
        .filter((l) => l.accountCode === code)
        .reduce((t, l) => t + l.debitPaise - l.creditPaise, 0);
      expect(net).toBe(0);
    }
  });
});
