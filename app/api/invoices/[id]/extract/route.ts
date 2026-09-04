import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/lib/auth/guard";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { getRiskLimits } from "@/src/lib/risk/controls";

async function extract(_request: NextRequest, context: { params: Promise<{ id: string }> }, auth: { tenantId: string }) {
  const { id } = await context.params;
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId: auth.tenantId } });
  if (!invoice) return NextResponse.json(errorEnvelope("NOT_FOUND", "Invoice not found"), { status: 404 });
  const limits = await getRiskLimits();
  if (limits.invoiceAutoProcessingHalted) return NextResponse.json(errorEnvelope("INVOICE_PROCESSING_HALTED", limits.invoiceHaltReason ?? "Invoice processing is halted"), { status: 503 });
  return NextResponse.json(successEnvelope({ invoice, resumable: invoice.extractionStatus !== "COMPLETE" }));
}

export const POST = withRateLimit("extraction", withAuth("OPERATOR", extract), { getIdentifier: getUserIdentifier });