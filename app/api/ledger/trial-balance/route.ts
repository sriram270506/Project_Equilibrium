import { NextResponse } from "next/server";
import { calculateTrialBalance } from "@/src/lib/ledger/trial-balance";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";

/**
 * GET /api/ledger/trial-balance
 *
 * Returns the trial balance and whether the ledger invariant holds.
 *
 * An imbalanced ledger is reported as a successful response carrying
 * `balanced: false`, not as a transport error. Returning 422 with an error
 * envelope was actively harmful: the single most important failure this system
 * can have would arrive at the UI as a generic message stripped of the numbers
 * needed to investigate it. Callers that need to page someone should watch the
 * flag, which is unambiguous and machine-readable.
 */
export async function GET() {
  try {
    const trialBalance = await calculateTrialBalance();

    return NextResponse.json(
      successEnvelope({
        trialBalance,
        balanced: trialBalance.balanced,
        message: trialBalance.balanced
          ? "Debits equal credits."
          : `Ledger out of balance by ${trialBalance.net} paise.`,
      })
    );
  } catch (error) {
    console.error("Error calculating trial balance:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to calculate trial balance"),
      { status: 500 }
    );
  }
}
