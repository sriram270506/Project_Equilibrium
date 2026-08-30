import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const cases = await prisma.reconciliationCase.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
    });

    const total = await prisma.reconciliationCase.count({ where });

    return NextResponse.json(
      successEnvelope({
        cases: cases.map((c) => ({
          id: c.id,
          paymentIntentId: c.paymentIntentId,
          outcome: c.outcome,
          severity: c.severity,
          status: c.status,
          internalAmount: c.internalAmountPaise,
          externalAmount: c.externalAmountPaise,
          createdAt: c.createdAt,
          resolvedAt: c.resolvedAt,
        })),
        total,
        limit,
        offset,
      })
    );
  } catch (error) {
    console.error("Error fetching reconciliation cases:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to fetch reconciliation cases"),
      { status: 500 }
    );
  }
}
