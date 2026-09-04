import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/lib/auth/guard";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";
import { prisma } from "@/src/lib/prisma";
import { runFinanceController } from "@/src/lib/controller/finance-controller";
import { errorEnvelope, successEnvelope } from "@/src/lib/api-envelope";

async function run(request: NextRequest, _context: unknown, auth: { tenantId: string }) {
  const body = (await request.json()) as { invoiceId?: string };
  if (!body.invoiceId) return NextResponse.json(errorEnvelope("VALIDATION_ERROR", "invoiceId is required"), { status: 400 });
  const result = await runFinanceController(auth.tenantId, body.invoiceId);
  return NextResponse.json(successEnvelope(result));
}

async function traces(request: NextRequest, _context: unknown, auth: { tenantId: string }) {
  const invoiceId = new URL(request.url).searchParams.get("invoiceId") ?? undefined;
  const rows = await prisma.controllerTrace.findMany({ where: { tenantId: auth.tenantId, invoiceId }, orderBy: { createdAt: "desc" }, take: 20 });
  return NextResponse.json(successEnvelope({ traces: rows.map((row) => ({ ...row, toolCalls: JSON.parse(row.toolCallsJson), facts: JSON.parse(row.factsJson) })) }));
}

export const POST = withRateLimit("anomalyScore", withAuth("OPERATOR", run), { getIdentifier: getUserIdentifier });
export const GET = withRateLimit("anomalyScore", withAuth("VIEWER", traces), { getIdentifier: getUserIdentifier });