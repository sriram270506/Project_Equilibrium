import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";
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

    const payments = await prisma.paymentIntent.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: { supplier: true },
    });

    const total = await prisma.paymentIntent.count({ where });

    return NextResponse.json(
      successEnvelope({
        payments: payments.map((p) => ({
          id: p.id,
          internalReference: p.internalReference,
          supplierId: p.supplierId,
          supplierName: p.supplier.name,
          amountPaise: p.amountPaise,
          amountDisplay: formatPaise(p.amountPaise),
          status: p.status,
          provider: p.provider,
          providerPaymentId: p.providerPaymentId,
          correlationId: p.correlationId,
          createdAt: p.createdAt,
          confirmedAt: p.confirmedAt,
        })),
        total,
        limit,
        offset,
      })
    );
  } catch (error) {
    console.error("Error fetching payments:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to fetch payments"),
      { status: 500 }
    );
  }
}
