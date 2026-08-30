import { runFullReconciliation } from "@/src/lib/reconciliation/reconciliation-service";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";

export async function POST(_request: NextRequest) {
  try {
    const results = await runFullReconciliation();

    return NextResponse.json(
      successEnvelope({
        casesCreatedOrUpdated: results.length,
        caseIds: results,
        message: "Reconciliation completed",
      })
    );
  } catch (error) {
    console.error("Error running reconciliation:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to run reconciliation"),
      { status: 500 }
    );
  }
}
