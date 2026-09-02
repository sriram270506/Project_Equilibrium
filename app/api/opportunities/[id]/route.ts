import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { explainPrediction } from "@/src/lib/ml/explain";
import { computeDealEconomics } from "@/src/lib/deal-economics";
import { FeatureSnapshot } from "@/src/lib/ml/model-artifact";
import { compareModelToBaseline } from "@/src/lib/ml/model-artifact";

/**
 * GET /api/opportunities/:id
 *
 * Returns everything an operator needs to make the decision without leaving the
 * page: the model's reasoning decomposed feature by feature, the money on both
 * sides of the trade, the policy verdict, and the supplier's recent cash
 * history.
 *
 * The explanation is recomputed from the STORED feature snapshot rather than
 * from the supplier's current state, so re-opening a decision months later
 * shows why it was made at the time, not what would be decided today.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const opportunity = await prisma.liquidityOpportunity.findUnique({
      where: { id },
      include: { supplier: true },
    });

    if (!opportunity) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", `No offer with id ${id}`),
        { status: 404 }
      );
    }

    const features: FeatureSnapshot = JSON.parse(
      opportunity.featureSnapshotJson
    );

    const explanation = explainPrediction(features);
    const comparison = compareModelToBaseline(features);

    // The receivable this advance is priced against.
    const DAYS_EARLY = 27;
    const deal = computeDealEconomics({
      faceValuePaise: opportunity.expectedBenefitPaise,
      daysEarly: DAYS_EARLY,
      discountBps: opportunity.recommendedDiscountBps,
    });

    // Recent cash history, for the runway chart.
    const observations = await prisma.liquidityObservation.findMany({
      where: { supplierId: opportunity.supplierId },
      orderBy: { observedAt: "asc" },
      take: 30,
      select: {
        observedAt: true,
        availableBalancePaise: true,
        inflowPaise: true,
        outflowPaise: true,
        daysRunway: true,
      },
    });

    // Any payment that came out of this offer.
    const payment = await prisma.paymentIntent.findFirst({
      where: { supplierId: opportunity.supplierId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, correlationId: true },
    });

    return NextResponse.json(
      successEnvelope({
        opportunity: {
          id: opportunity.id,
          status: opportunity.status,
          probability: opportunity.predictionProbability,
          modelVersion: opportunity.modelVersion,
          policyVersion: opportunity.policyVersion,
          decisionReason: opportunity.decisionReason,
          expectedValuePaise: opportunity.expectedValuePaise,
          expectedBenefitPaise: opportunity.expectedBenefitPaise,
          opportunityCostPaise: opportunity.opportunityCostPaise,
          riskCostPaise: opportunity.riskCostPaise,
          recommendedDiscountBps: opportunity.recommendedDiscountBps,
          maxAllowedDiscountPaise: opportunity.maxAllowedDiscountPaise,
          createdAt: opportunity.createdAt,
        },
        supplier: {
          id: opportunity.supplier.id,
          name: opportunity.supplier.name,
          email: opportunity.supplier.email,
          riskTier: opportunity.supplier.riskTier,
          since: opportunity.supplier.createdAt,
        },
        explanation,
        comparison,
        deal,
        observations: observations.map((o) => ({
          date: o.observedAt,
          balancePaise: o.availableBalancePaise,
          inflowPaise: o.inflowPaise,
          outflowPaise: o.outflowPaise,
          daysRunway: o.daysRunway,
        })),
        payment,
      })
    );
  } catch (error) {
    console.error("Error fetching opportunity:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to load the offer"),
      { status: 500 }
    );
  }
}
