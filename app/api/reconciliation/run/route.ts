import { runFullReconciliation } from "@/src/lib/reconciliation/reconciliation-service";
import { successEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withAuth, getAuthContext } from "@/src/lib/api/auth-middleware";

export const POST = withErrorHandler(
  withAuth("OPERATOR", async (request: NextRequest) => {
    const authContext = getAuthContext(request);
    const tenantId = authContext.tenantContext?.tenantId;

    const results = await runFullReconciliation(tenantId);

    return NextResponse.json(
      successEnvelope({
        casesCreatedOrUpdated: results.length,
        caseIds: results,
        triggeredBy: authContext.userId,
        message: "Reconciliation completed",
      })
    );
  })
);
