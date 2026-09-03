import { NextRequest, NextResponse } from "next/server";
import { approveOpportunity } from "@/src/server/opportunity-service";
import { submitPaymentToProvider } from "@/src/lib/payments/payment-service";
import { successEnvelope } from "@/src/lib/api-envelope";
import { withAuth, getAuthContext } from "@/src/lib/api/auth-middleware";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";

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
 *
 * Rate limited to 100 approvals per hour per user.
 */
const approveHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authContext = getAuthContext(request);
  const { id } = await params;

  const result = await approveOpportunity(id, authContext.userId);

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
};

export const POST = withErrorHandler(
  withAuth(
    "OPERATOR",
    withRateLimit("approval", approveHandler, {
      getIdentifier: getUserIdentifier,
    })
  )
);
