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

    const opportunities = await prisma.liquidityOpportunity.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: true,
      },
    });

    const total = await prisma.liquidityOpportunity.count({ where });

    return NextResponse.json(
      successEnvelope({
        opportunities: opportunities.map((opp) => ({
          id: opp.id,
          supplierId: opp.supplierId,
          supplierName: opp.supplier.name,
          predictionProbability: opp.predictionProbability,
          expectedValuePaise: opp.expectedValuePaise,
          status: opp.status,
          createdAt: opp.createdAt,
          updatedAt: opp.updatedAt,
        })),
        total,
        limit,
        offset,
      })
    );
  } catch (error) {
    console.error("Error fetching opportunities:", error);
    return NextResponse.json(
      errorEnvelope(
        "INTERNAL_ERROR",
        "Failed to fetch opportunities"
      ),
      { status: 500 }
    );
  }
}
