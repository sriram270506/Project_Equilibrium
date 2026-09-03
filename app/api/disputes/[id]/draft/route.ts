import { generateDisputeDraft } from "@/src/lib/disputes/draft-service";
import { successEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withAuth, getCaller } from "@/src/lib/api/auth-middleware";
import { NotFoundError } from "@/src/lib/errors";

export const POST = withErrorHandler(
  withAuth("OPERATOR", async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const caller = getCaller(request);
    const { id } = await params;
    const body = await request.json();

    const result = await generateDisputeDraft(id, caller.userId);

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
  })
);
