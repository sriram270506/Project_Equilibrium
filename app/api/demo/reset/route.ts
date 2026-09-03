import { successEnvelope } from "@/src/lib/api-envelope";
import { assertDemoMode } from "@/src/lib/env";
import { prisma } from "@/src/lib/prisma";
import { LIQUIDITY_MODEL } from "@/src/lib/ml/model-artifact";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withAuth, getAuthContext } from "@/src/lib/api/auth-middleware";
import { ValidationError } from "@/src/lib/errors";

export const POST = withErrorHandler(
  withAuth("ADMIN", async (request: NextRequest) => {
    const authContext = getAuthContext(request);
    assertDemoMode(); // Demo-only endpoint

    const body = await request.json();
    if (!body.confirm) {
      throw new ValidationError("Reset confirmation required");
    }

    // Get or create demo tenant
    let tenant = await prisma.tenant.findUnique({
      where: { slug: "demo" },
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          slug: "demo",
          name: "Demo Tenant",
          users: {
            create: {
              userId: authContext.userId,
              role: "ADMIN",
            },
          },
        },
        include: {
          users: true,
        },
      });
    }

    // Clear all tenant data
    await prisma.mockProviderRecord.deleteMany();
    await prisma.reconciliationCase.deleteMany();
    await prisma.disputeDraft.deleteMany();
    await prisma.evidenceClaim.deleteMany();
    await prisma.evidenceDocument.deleteMany();
    await prisma.disputeCase.deleteMany({
      where: { tenantId: tenant.id },
    });
    await prisma.auditEvent.deleteMany({
      where: { tenantId: tenant.id },
    });
    await prisma.eventRecord.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.ledgerTransaction.deleteMany();
    await prisma.paymentIntent.deleteMany({
      where: { tenantId: tenant.id },
    });
    await prisma.liquidityOpportunity.deleteMany({
      where: { tenantId: tenant.id },
    });
    await prisma.liquidityObservation.deleteMany();
    await prisma.supplier.deleteMany({
      where: { tenantId: tenant.id },
    });

    // Re-seed database
    const { v4: uuidv4 } = await import("uuid");

    // Create suppliers
    const suppliers = await Promise.all([
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          tenantId: tenant.id,
          name: "Aarav Industrial Components",
          email: "finance@aarav.in",
          riskTier: "LOW",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          tenantId: tenant.id,
          name: "Nila Packaging Works",
          email: "admin@nila.in",
          riskTier: "MEDIUM",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          tenantId: tenant.id,
          name: "Saffron Retail Supply",
          email: "ops@saffron.in",
          riskTier: "MEDIUM",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          tenantId: tenant.id,
          name: "Meridian Home Goods",
          email: "finance@meridian.in",
          riskTier: "LOW",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          tenantId: tenant.id,
          name: "Kaveri Logistics Parts",
          email: "billing@kaveri.in",
          riskTier: "HIGH",
        },
      }),
      prisma.supplier.create({
        data: {
          id: uuidv4(),
          tenantId: tenant.id,
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
        tenantId: tenant.id,
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
        tenantId: tenant.id,
        resetBy: authContext.userId,
      })
    );
  })
);
