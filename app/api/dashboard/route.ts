import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Get KPIs
    const recommendedOpportunities = await prisma.liquidityOpportunity.count({
      where: { status: "RECOMMENDED" },
    });

    const opportunities = await prisma.liquidityOpportunity.findMany({
      where: { status: { in: ["RECOMMENDED", "APPROVED"] } },
      select: { expectedValuePaise: true },
    });

    const totalExpectedValue = opportunities.reduce(
      (sum, opp) => sum + opp.expectedValuePaise,
      0
    );

    const paymentsByStatus = await prisma.paymentIntent.groupBy({
      by: ["status"],
      _count: true,
    });

    const openReconciliationCases = await prisma.reconciliationCase.count({
      where: { status: { in: ["OPEN", "INVESTIGATING"] } },
    });

    // Get recent payments
    const recentPayments = await prisma.paymentIntent.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { supplier: true },
    });

    return NextResponse.json(
      successEnvelope({
        kpis: {
          recommendedOpportunities,
          expectedValuePaise: totalExpectedValue,
          expectedValueDisplay: formatPaise(totalExpectedValue),
          activePaymentIntents: paymentsByStatus.reduce(
            (sum, group) =>
              sum +
              (["SUBMITTED", "ACKNOWLEDGED", "UNKNOWN", "CONFIRMED"].includes(
                group.status
              )
                ? group._count
                : 0),
            0
          ),
          openReconciliationCases,
        },
        paymentsByStatus: Object.fromEntries(
          paymentsByStatus.map((g) => [g.status, g._count])
        ),
        recentPayments: recentPayments.map((p) => ({
          id: p.id,
          supplierName: p.supplier.name,
          amountPaise: p.amountPaise,
          amountDisplay: formatPaise(p.amountPaise),
          status: p.status,
          createdAt: p.createdAt,
        })),
        systemHealth: {
          status: "operational",
          mode: process.env.APP_MODE || "demo",
          provider: process.env.RAZORPAY_MODE || "mock",
        },
      })
    );
  } catch (error) {
    console.error("Error fetching dashboard:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to fetch dashboard"),
      { status: 500 }
    );
  }
}
