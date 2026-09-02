import { NextRequest, NextResponse } from "next/server";
import { confirmSecondApproval } from "@/src/server/opportunity-service";
import { submitPaymentToProvider } from "@/src/lib/payments/payment-service";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { RiskControlError } from "@/src/lib/risk/controls";

/**
 * POST /api/payments/:id/approve
 *
 * The checker half of maker-checker. Requires the APPROVER role, and the
 * service refuses if the caller is the same person who raised the payment.
 */
export const POST = withAuth<{ params: Promise<{ id: string }> }>(
  "APPROVER",
  async (_request: NextRequest, { params }, auth) => {
    try {
      const { id } = await params;

      await confirmSecondApproval(id, auth.userId);
      const paymentStatus = await submitPaymentToProvider(id);

      return NextResponse.json(
        successEnvelope({
          paymentIntentId: id,
          status: paymentStatus,
          checkedBy: auth.name,
          message: "Second approval granted and payment submitted.",
        })
      );
    } catch (error) {
      if (error instanceof RiskControlError) {
        return NextResponse.json(
          errorEnvelope("RISK_CONTROL_BLOCKED", error.message, {
            violations: error.violations,
          }),
          { status: 409 }
        );
      }

      const message = (error as Error).message;
      console.error("Error granting second approval:", error);

      if (message.includes("not found")) {
        return NextResponse.json(errorEnvelope("NOT_FOUND", message), {
          status: 404,
        });
      }

      if (message.includes("different person")) {
        return NextResponse.json(
          errorEnvelope("SELF_APPROVAL_REFUSED", message),
          { status: 403 }
        );
      }

      if (message.includes("not awaiting")) {
        return NextResponse.json(errorEnvelope("INVALID_STATE", message), {
          status: 409,
        });
      }

      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to grant second approval"),
        { status: 500 }
      );
    }
  }
);
