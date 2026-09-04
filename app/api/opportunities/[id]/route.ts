import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { explainPrediction } from "@/src/lib/ml/explain";
import { computeDealEconomics } from "@/src/lib/deal-economics";
import {
  compareWithIntervention,
  projectionInputFromObservation,
} from "@/src/lib/forecast/cash-projection";
import { benchmarkRate } from "@/src/lib/benchmark/market-data";
import { FeatureSnapshot } from "@/src/lib/ml/model-artifact";
import { compareModelToBaseline } from "@/src/lib/ml/model-artifact";

/** Days between the advance and the invoice due date. */
const DAYS_EARLY = 27;

/** Stable numeric seed from a string id, so charts do not shimmer. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
    const deal = computeDealEconomics({
      faceValuePaise: opportunity.expectedBenefitPaise,
      daysEarly: DAYS_EARLY,
      discountBps: opportunity.recommendedDiscountBps,
    });

    /*
     * Forward projection, so the page can show WHEN this supplier runs out
     * rather than only how likely it is. Built from the latest observation and
     * compared against the same simulation with the advance applied.
     */
    const latestObservation = await prisma.liquidityObservation.findFirst({
      where: { supplierId: opportunity.supplierId },
      orderBy: { observedAt: "desc" },
    });

    const forecast = latestObservation
      ? compareWithIntervention(
          {
            ...projectionInputFromObservation(latestObservation),
            // Seed from the offer id so the chart is stable across renders and
            // identical for two people looking at the same offer.
            seed: hashSeed(opportunity.id),
          },
          opportunity.expectedBenefitPaise
        )
      : null;

    // Price this offer against the regulated incumbent, honestly.
    const rateBenchmark = benchmarkRate(
      Math.round((opportunity.recommendedDiscountBps * 365) / DAYS_EARLY)
    );

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
        forecast,
        rateBenchmark,
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
