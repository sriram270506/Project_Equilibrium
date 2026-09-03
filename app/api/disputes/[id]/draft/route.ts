import { generateDisputeDraft } from "@/src/lib/disputes/draft-service";
import { successEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withAuth, getAuthContext } from "@/src/lib/api/auth-middleware";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";
import { NotFoundError } from "@/src/lib/errors";

const disputeDraftHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authContext = getAuthContext(request);
  const { id } = await params;

  if (!authContext.tenantContext) {
    throw new NotFoundError("Tenant context not available");
  }

  const result = await generateDisputeDraft(
    authContext.tenantContext.tenantId,
    id,
    authContext.userId
  );

  if (!result) {
    throw new NotFoundError("Dispute case not found");
  }

  const statusCode =
    result.validationStatus === "PASSED" ? 201 : 200;

  return NextResponse.json(
    successEnvelope({
      draftId: result.draftId,
      validationStatus: result.validationStatus,
      validationErrors: result.validationErrors,
      draftText: result.draftText,
      message:
        result.validationStatus === "PASSED"
          ? "Draft generated and validated"
          : result.validationStatus === "NEEDS_REVIEW"
            ? "Draft generated but requires manual review"
            : "Draft generation failed",
    }),
    { status: statusCode }
  );
};

export const POST = withErrorHandler(
  withAuth(
    "OPERATOR",
    withRateLimit("dispute", disputeDraftHandler, {
      getIdentifier: getUserIdentifier,
    })
  )
);
