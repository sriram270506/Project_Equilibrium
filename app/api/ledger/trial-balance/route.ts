import { NextResponse } from "next/server";
import { calculateTrialBalance, assertLedgerBalanced, getAllAccountBalances } from "@/src/lib/ledger/trial-balance";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";

/**
 * GET /api/ledger/trial-balance
 * Returns trial balance and validates ledger invariant
 */
export async function GET() {
  try {
    // Calculate trial balance
    const trialBalance = await calculateTrialBalance();

    // Validate ledger invariant
    try {
      await assertLedgerBalanced();
    } catch (error) {
      // If ledger is not balanced, return it anyway but flag as error
      return NextResponse.json(
        errorEnvelope(
          "LEDGER_IMBALANCED",
          (error as Error).message
        ),
        { status: 422 }
      );
    }

    return NextResponse.json(
      successEnvelope({
        trialBalance,
        status: "balanced",
        message: "Ledger is balanced",
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error calculating trial balance:", error);
    return NextResponse.json(
      errorEnvelope(
        "INTERNAL_ERROR",
        "Failed to calculate trial balance"
      ),
      { status: 500 }
    );
  }
}

/**
 * GET /api/ledger/accounts
 * Returns all account balances
 */
export async function getAccountBalances() {
  try {
    const accounts = await getAllAccountBalances();

    return NextResponse.json(
      successEnvelope({
        accounts,
        count: accounts.length,
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching account balances:", error);
    return NextResponse.json(
      errorEnvelope(
        "INTERNAL_ERROR",
        "Failed to fetch account balances"
      ),
      { status: 500 }
    );
  }
}
