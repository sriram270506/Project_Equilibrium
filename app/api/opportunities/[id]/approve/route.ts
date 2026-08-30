import { approveOpportunity } from "@/src/server/opportunity-service";
import { submitPaymentToProvider } from "@/src/lib/payments/payment-service";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const operatorId = body.operatorId || "demo-finance-operator";

    // Approve opportunity and create payment intent
    const result = await approveOpportunity(id, operatorId);

    // Submit to provider
    const paymentStatus = await submitPaymentToProvider(result.paymentIntentId);

    return NextResponse.json(
      successEnvelope({
        paymentIntentId: result.paymentIntentId,
        status: paymentStatus,
        correlationId: result.correlationId,
        message: "Opportunity approved and payment submitted",
      }),
      { status: 201 }
    );
  } catch (error) {
    const message = (error as Error).message;
    console.error("Error approving opportunity:", error);

    if (message.includes("not found")) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", message),
        { status: 404 }
      );
    }

    if (message.includes("Cannot approve")) {
      return NextResponse.json(
        errorEnvelope("INVALID_STATE", message),
        { status: 409 }
      );
    }

    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to approve opportunity"),
      { status: 500 }
    );
  }
}
