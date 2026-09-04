import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/lib/auth/guard";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { transitionAnomaly } from "@/src/lib/invoices/pipeline";

async function score(_request: NextRequest, context: { params: Promise<{ id: string }> }, auth: { tenantId: string }) {
  const { id } = await context.params;
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId: auth.tenantId } });
  if (!invoice) return NextResponse.json(errorEnvelope("NOT_FOUND", "Invoice not found"), { status: 404 });
  return NextResponse.json(successEnvelope({ anomalyRisk: invoice.anomalyRisk, anomalyScore: invoice.anomalyScore, reasons: JSON.parse(invoice.anomalyReasonCodesJson), status: invoice.anomalyStatus }));
}

async function transition(request: NextRequest, context: { params: Promise<{ id: string }> }, auth: { tenantId: string }) {
  const { id } = await context.params;
  const body = (await request.json()) as { status?: "ACKNOWLEDGED" | "CLEARED" };
  if (body.status !== "ACKNOWLEDGED" && body.status !== "CLEARED") {
    return NextResponse.json(errorEnvelope("VALIDATION_ERROR", "status must be ACKNOWLEDGED or CLEARED"), { status: 400 });
  }
  const invoice = await transitionAnomaly(id, auth.tenantId, body.status);
  return NextResponse.json(successEnvelope({ invoice }));
}

export const POST = withRateLimit("anomalyScore", withAuth("OPERATOR", score), { getIdentifier: getUserIdentifier });
export const PATCH = withRateLimit("anomalyScore", withAuth("OPERATOR", transition), { getIdentifier: getUserIdentifier });