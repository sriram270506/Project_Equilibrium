import { generateDisputeDraft } from "@/src/lib/disputes/draft-service";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const createdBy = body.createdBy || "system";

    const result = await generateDisputeDraft(id, createdBy);

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
  } catch (error) {
    const message = (error as Error).message;
    console.error("Error generating dispute draft:", error);

    if (message.includes("not found")) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", message),
        { status: 404 }
      );
    }

    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to generate dispute draft"),
      { status: 500 }
    );
  }
}
