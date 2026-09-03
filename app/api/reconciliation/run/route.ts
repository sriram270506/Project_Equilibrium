import { runFullReconciliation } from "@/src/lib/reconciliation/reconciliation-service";
import { successEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withAuth, getCaller } from "@/src/lib/api/auth-middleware";

export const POST = withErrorHandler(
  withAuth("OPERATOR", async (_request: NextRequest) => {
    const caller = getCaller(_request);
    const results = await runFullReconciliation();

    return NextResponse.json(
      successEnvelope({
        casesCreatedOrUpdated: results.length,
        caseIds: results,
        triggeredBy: caller.userId,
        message: "Reconciliation completed",
      })
    );
  })
);
