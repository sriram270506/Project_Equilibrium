import { prisma } from "../prisma";

/**
 * Trial balance calculation and ledger invariant enforcement
 */

export interface AccountBalance {
  accountCode: string;
  debitPaise: number;
  creditPaise: number;
  netPaise: number; // debit - credit
}

export interface TrialBalance {
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  net: number;
  accounts: AccountBalance[];
  asOfDate: Date;
}

/**
 * Calculate trial balance across all ledger entries
 * Ledger invariant: sum of debits must equal sum of credits
 */
export async function calculateTrialBalance(): Promise<TrialBalance> {
  // Get all ledger entries
  const entries = await prisma.ledgerEntry.findMany({
    include: {
      transaction: true,
    },
  });

  // Aggregate by account code
  const accountMap = new Map<string, AccountBalance>();

  for (const entry of entries) {
    if (!accountMap.has(entry.accountCode)) {
      accountMap.set(entry.accountCode, {
        accountCode: entry.accountCode,
        debitPaise: 0,
        creditPaise: 0,
        netPaise: 0,
      });
    }

    const account = accountMap.get(entry.accountCode)!;
    account.debitPaise += entry.debitPaise;
    account.creditPaise += entry.creditPaise;
    account.netPaise = account.debitPaise - account.creditPaise;
  }

  const accounts = Array.from(accountMap.values());
  const totalDebits = accounts.reduce((sum, acc) => sum + acc.debitPaise, 0);
  const totalCredits = accounts.reduce((sum, acc) => sum + acc.creditPaise, 0);
  const net = totalDebits - totalCredits;

  return {
    totalDebits,
    totalCredits,
    balanced: Math.abs(net) < 1, // Account for floating point errors
    net,
    accounts: accounts.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
    asOfDate: new Date(),
  };
}

/**
 * Validate ledger invariant: total debits must equal total credits
 * Throws error if invariant is violated
 */
export async function assertLedgerBalanced(): Promise<void> {
  const trialBalance = await calculateTrialBalance();

  if (!trialBalance.balanced) {
    throw new Error(
      `Ledger invariant violation: total debits (${trialBalance.totalDebits}) ≠ total credits (${trialBalance.totalCredits}). Net imbalance: ${trialBalance.net} paise`
    );
  }
}

/**
 * Get account balance for a specific account code
 */
export async function getAccountBalance(accountCode: string): Promise<AccountBalance | null> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { accountCode },
  });

  if (entries.length === 0) {
    return null;
  }

  const debitPaise = entries.reduce((sum, e) => sum + e.debitPaise, 0);
  const creditPaise = entries.reduce((sum, e) => sum + e.creditPaise, 0);

  return {
    accountCode,
    debitPaise,
    creditPaise,
    netPaise: debitPaise - creditPaise,
  };
}

/**
 * Get all account balances
 */
export async function getAllAccountBalances(): Promise<AccountBalance[]> {
  const accounts = await prisma.ledgerEntry.findMany({
    distinct: ["accountCode"],
    select: {
      accountCode: true,
    },
  });

  const balances = [];
  for (const { accountCode } of accounts) {
    const balance = await getAccountBalance(accountCode);
    if (balance) {
      balances.push(balance);
    }
  }

  return balances.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/**
 * Get ledger entries for a specific transaction
 */
export async function getTransactionEntries(transactionId: string) {
  return prisma.ledgerEntry.findMany({
    where: {
      transactionId,
    },
    include: {
      transaction: true,
    },
  });
}

/**
 * Get ledger entries for a specific reference (payment intent, etc.)
 */
export async function getTransactionsByReference(
  referenceType: string,
  referenceId: string
) {
  return prisma.ledgerTransaction.findMany({
    where: {
      referenceType,
      referenceId,
    },
    include: {
      entries: true,
    },
  });
}
