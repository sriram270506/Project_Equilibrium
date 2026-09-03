import { NextRequest, NextResponse } from "next/server";
import { confirmSecondApproval } from "@/src/server/opportunity-service";
import { submitPaymentToProvider } from "@/src/lib/payments/payment-service";
import { successEnvelope } from "@/src/lib/api-envelope";
import { withAuth, getAuthContext } from "@/src/lib/api/auth-middleware";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";

/**
 * POST /api/payments/:id/approve
 *
 * The checker half of maker-checker. Requires the APPROVER role, and the
 * service refuses if the caller is the same person who raised the payment.
 *
 * Rate limited to 100 approvals per hour per user.
 */
const approvePaymentHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authContext = getAuthContext(request);
  const { id } = await params;

  await confirmSecondApproval(id, authContext.userId);
  const paymentStatus = await submitPaymentToProvider(id);

  return NextResponse.json(
    successEnvelope({
      paymentIntentId: id,
      status: paymentStatus,
      checkedBy: authContext.userId,
      message: "Second approval granted and payment submitted.",
    })
  );
};

export const POST = withErrorHandler(
  withAuth(
    "APPROVER",
    withRateLimit("approval", approvePaymentHandler, {
      getIdentifier: getUserIdentifier,
    })
  )
);
