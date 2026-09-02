import { NextRequest, NextResponse } from "next/server";
import { approveOpportunity } from "@/src/server/opportunity-service";
import { submitPaymentToProvider } from "@/src/lib/payments/payment-service";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { RiskControlError } from "@/src/lib/risk/controls";

/**
 * POST /api/opportunities/:id/approve
 *
 * Approves an early-payment offer and, unless the amount requires a second
 * approver, submits it to the provider.
 *
 * The approving operator is taken from the authenticated caller. It used to be
 * read from the request body, which meant anyone could attribute a payment to
 * anyone - an audit trail that records whatever the caller claims is worse than
 * no audit trail, because it looks trustworthy.
 */
export const POST = withAuth<{ params: Promise<{ id: string }> }>(
  "OPERATOR",
  async (_request: NextRequest, { params }, auth) => {
    try {
      const { id } = await params;

      const result = await approveOpportunity(id, auth.userId);

      // Held for a second approver: nothing goes to the provider yet.
      if (result.requiresDualApproval) {
        return NextResponse.json(
          successEnvelope({
            paymentIntentId: result.paymentIntentId,
            status: result.status,
            correlationId: result.correlationId,
            requiresDualApproval: true,
            message:
              "Approved, but this amount is above the dual-approval threshold. A second operator must confirm before any money moves.",
          }),
          { status: 201 }
        );
      }

      const paymentStatus = await submitPaymentToProvider(
        result.paymentIntentId
      );

      return NextResponse.json(
        successEnvelope({
          paymentIntentId: result.paymentIntentId,
          status: paymentStatus,
          correlationId: result.correlationId,
          requiresDualApproval: false,
          message: "Offer approved and payment submitted.",
        }),
        { status: 201 }
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
      console.error("Error approving opportunity:", error);

      if (message.includes("not found")) {
        return NextResponse.json(errorEnvelope("NOT_FOUND", message), {
          status: 404,
        });
      }

      if (
        message.includes("Cannot approve") ||
        message.includes("Invalid opportunity transition")
      ) {
        return NextResponse.json(errorEnvelope("INVALID_STATE", message), {
          status: 409,
        });
      }

      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to approve the offer"),
        { status: 500 }
      );
    }
  }
);
