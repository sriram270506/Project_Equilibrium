import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";

/**
 * GET /api/reconciliation
 *
 * The exception queue: every case, with both sides of the disagreement and the
 * payment it concerns, so an operator can triage without opening five tabs.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const severity = searchParams.get("severity");

    const where: {
      status?: string | { in: string[] };
      severity?: string;
    } = {};

    if (status === "open") where.status = { in: ["OPEN", "INVESTIGATING"] };
    else if (status) where.status = status;
    if (severity) where.severity = severity;

    const cases = await prisma.reconciliationCase.findMany({
      where,
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      take: 100,
    });

    // Attach the payment and supplier each case concerns.
    const paymentIds = cases
      .map((c) => c.paymentIntentId)
      .filter((id): id is string => Boolean(id));

    const payments = await prisma.paymentIntent.findMany({
      where: { id: { in: paymentIds } },
      include: { supplier: true },
    });
    const paymentById = new Map(payments.map((p) => [p.id, p]));

    const counts = await prisma.reconciliationCase.groupBy({
      by: ["severity"],
      where: { status: { in: ["OPEN", "INVESTIGATING"] } },
      _count: true,
    });

    return NextResponse.json(
      successEnvelope({
        cases: cases.map((c) => {
          const payment = c.paymentIntentId
            ? paymentById.get(c.paymentIntentId)
            : undefined;
          const difference =
            c.externalAmountPaise === null || c.internalAmountPaise === null
              ? null
              : c.internalAmountPaise - c.externalAmountPaise;

          return {
            id: c.id,
            outcome: c.outcome,
            severity: c.severity,
            status: c.status,
            internalAmountPaise: c.internalAmountPaise ?? 0,
            externalAmountPaise: c.externalAmountPaise,
            differencePaise: difference,
            differenceDisplay:
              difference === null ? null : formatPaise(Math.abs(difference)),
            correlationId: c.correlationId,
            providerReference: c.providerReference,
            notes: c.notes,
            createdAt: c.createdAt,
            resolvedAt: c.resolvedAt,
            paymentIntentId: c.paymentIntentId,
            supplierName: payment?.supplier.name ?? null,
            paymentStatus: payment?.status ?? null,
          };
        }),
        summary: {
          openCritical:
            counts.find((c) => c.severity === "CRITICAL")?._count ?? 0,
          openWarning:
            counts.find((c) => c.severity === "WARNING")?._count ?? 0,
          openInfo: counts.find((c) => c.severity === "INFO")?._count ?? 0,
        },
      })
    );
  } catch (error) {
    console.error("Error fetching reconciliation cases:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to load reconciliation cases"),
      { status: 500 }
    );
  }
}
