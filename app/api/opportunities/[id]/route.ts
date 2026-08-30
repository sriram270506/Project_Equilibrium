import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const opportunity = await prisma.liquidityOpportunity.findUnique({
      where: { id },
      include: {
        supplier: true,
      },
    });

    if (!opportunity) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", "Opportunity not found"),
        { status: 404 }
      );
    }

    return NextResponse.json(
      successEnvelope({
        id: opportunity.id,
        supplierId: opportunity.supplierId,
        supplier: opportunity.supplier,
        predictionProbability: opportunity.predictionProbability,
        modelVersion: opportunity.modelVersion,
        featureSnapshot: JSON.parse(opportunity.featureSnapshotJson),
        policyVersion: opportunity.policyVersion,
        expectedBenefitPaise: opportunity.expectedBenefitPaise,
        opportunityCostPaise: opportunity.opportunityCostPaise,
        riskCostPaise: opportunity.riskCostPaise,
        expectedValuePaise: opportunity.expectedValuePaise,
        recommendedDiscountBps: opportunity.recommendedDiscountBps,
        maxAllowedDiscountPaise: opportunity.maxAllowedDiscountPaise,
        status: opportunity.status,
        decisionReason: opportunity.decisionReason,
        createdAt: opportunity.createdAt,
        updatedAt: opportunity.updatedAt,
      })
    );
  } catch (error) {
    console.error("Error fetching opportunity:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to fetch opportunity"),
      { status: 500 }
    );
  }
}
