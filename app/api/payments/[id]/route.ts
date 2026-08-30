import { getPaymentDetails } from "@/src/lib/payments/payment-service";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const payment = await getPaymentDetails(id);

    if (!payment) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", "Payment not found"),
        { status: 404 }
      );
    }

    return NextResponse.json(
      successEnvelope({
        id: payment.id,
        internalReference: payment.internalReference,
        supplier: payment.supplier,
        amountPaise: payment.amount,
        amountDisplay: formatPaise(payment.amount),
        status: payment.status,
        operationType: payment.operationType,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        providerOrderId: payment.providerOrderId,
        correlationId: payment.correlationId,
        failureMode: payment.failureMode,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        confirmedAt: payment.confirmedAt,
        ledger: payment.ledger,
        timeline: payment.timeline,
      })
    );
  } catch (error) {
    console.error("Error fetching payment:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to fetch payment"),
      { status: 500 }
    );
  }
}
