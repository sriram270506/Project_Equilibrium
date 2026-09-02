import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { assertDemoMode } from "@/src/lib/env";
import { prisma } from "@/src/lib/prisma";
import { LIQUIDITY_MODEL } from "@/src/lib/ml/model-artifact";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    assertDemoMode();

    const body = await request.json();
    if (!body.confirm) {
      return NextResponse.json(
        errorEnvelope("VALIDATION_ERROR", "Reset confirmation required"),
        { status: 400 }
      );
    }

    // Clear all data
    await prisma.mockProviderRecord.deleteMany();
    await prisma.reconciliationCase.deleteMany();
    await prisma.disputeDraft.deleteMany();
    await prisma.evidenceClaim.deleteMany();
    await prisma.evidenceDocument.deleteMany();
    await prisma.disputeCase.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.eventRecord.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.ledgerTransaction.deleteMany();
    await prisma.paymentIntent.deleteMany();
    await prisma.liquidityOpportunity.deleteMany();
    await prisma.liquidityObservation.deleteMany();
    await prisma.supplier.deleteMany();

    // Re-seed database by importing and running seed
    const { v4: uuidv4 } = await import("uuid");

    // Create suppliers
    const suppliers = await Promise.all([
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          name: "Aarav Industrial Components",
          email: "finance@aarav.in",
          riskTier: "LOW",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          name: "Nila Packaging Works",
          email: "admin@nila.in",
          riskTier: "MEDIUM",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          name: "Saffron Retail Supply",
          email: "ops@saffron.in",
          riskTier: "MEDIUM",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          name: "Meridian Home Goods",
          email: "finance@meridian.in",
          riskTier: "LOW",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          name: "Kaveri Logistics Parts",
          email: "billing@kaveri.in",
          riskTier: "HIGH",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          name: "Orbit Kitchenware",
          email: "finance@orbit.in",
          riskTier: "MEDIUM",
        },
      }),
    ]);

    // Create a few observations and an opportunity
    const aarav = suppliers[0];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const observedAt = new Date(now);
      observedAt.setDate(observedAt.getDate() - i);
      await prisma.liquidityObservation.create({
        data: {
          id: uuidv4(),
          supplierId: aarav.id,
          observedAt,
          availableBalancePaise: 500000 + Math.random() * 100000,
          inflowPaise: 200000 + Math.random() * 50000,
          outflowPaise: 250000 + Math.random() * 50000,
          daysRunway: 2.5 + Math.random() * 2,
          paymentRegularity: 0.85 + Math.random() * 0.1,
          volatility: 0.15 + Math.random() * 0.1,
          source: "DEMO_SYNTHETIC",
        },
      });
    }

    await prisma.liquidityOpportunity.create({
      data: {
        id: uuidv4(),
        supplierId: aarav.id,
        predictionProbability: 0.78,
        modelVersion: LIQUIDITY_MODEL.modelVersion,
        featureSnapshotJson: JSON.stringify({
          cashFlowVolatility: 0.18,
          daysRunwayTrend: -0.05,
          paymentTimingRegularity: 0.88,
          availableBalanceRatio: 0.42,
          supplierTenureDays: 1250,
        }),
        policyVersion: "policy-v1-demo",
        expectedBenefitPaise: 150000,
        opportunityCostPaise: 5000,
        riskCostPaise: 30000,
        expectedValuePaise: 115000,
        recommendedDiscountBps: 120,
        maxAllowedDiscountPaise: 250000,
        status: "RECOMMENDED",
        decisionReason: "Model probability and policy approval align",
      },
    });

    return NextResponse.json(
      successEnvelope({
        message: "Demo data reset successfully",
        suppliersCreated: suppliers.length,
      })
    );
  } catch (error) {
    const message = (error as Error).message;
    console.error("Error resetting demo:", error);

    if (message.includes("demo mode")) {
      return NextResponse.json(
        errorEnvelope("FORBIDDEN", message),
        { status: 403 }
      );
    }

    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to reset demo"),
      { status: 500 }
    );
  }
}
