import { PrismaClient } from "@prisma/client";
// @ts-ignore - uuid types
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // Clear existing data
  await prisma.mockProviderRecord.deleteMany();
  await prisma.demoScenario.deleteMany();
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

  console.log(`✅ Created ${suppliers.length} suppliers`);

  // Create liquidity observations
  const aarav = suppliers[0];
  const now = new Date();

  for (let i = 30; i >= 0; i--) {
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

  console.log("✅ Created liquidity observations");

  // Create opportunities
  const opportunities = await Promise.all([
    prisma.liquidityOpportunity.create({
      data: {
        id: uuidv4(),
        supplierId: aarav.id,
        predictionProbability: 0.78,
        modelVersion: "liquidity-logistic-v1-demo",
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
    }),
    prisma.liquidityOpportunity.create({
      data: {
        id: uuidv4(),
        supplierId: suppliers[1].id,
        predictionProbability: 0.62,
        modelVersion: "liquidity-logistic-v1-demo",
        featureSnapshotJson: JSON.stringify({
          cashFlowVolatility: 0.22,
          daysRunwayTrend: -0.12,
          paymentTimingRegularity: 0.75,
          availableBalanceRatio: 0.35,
          supplierTenureDays: 890,
        }),
        policyVersion: "policy-v1-demo",
        expectedBenefitPaise: 100000,
        opportunityCostPaise: 3000,
        riskCostPaise: 45000,
        expectedValuePaise: 52000,
        recommendedDiscountBps: 100,
        maxAllowedDiscountPaise: 200000,
        status: "APPROVED",
        decisionReason: "Finance approver accepted recommendation",
      },
    }),
  ]);

  console.log(`✅ Created ${opportunities.length} opportunities`);

  // Create a payment intent for the approved opportunity
  const paymentIntentId = uuidv4();
  const internalRef = `INT_${Date.now()}`;
  const providerPaymentId = `pay_demo_${uuidv4().slice(0, 12)}`;
  const correlationId = `corr_${uuidv4()}`;

  await prisma.paymentIntent.create({
    data: {
      id: paymentIntentId,
      internalReference: internalRef,
      provider: "RAZORPAY",
      providerPaymentId,
      providerOrderId: `ord_demo_${uuidv4().slice(0, 12)}`,
      operationType: "DISCOUNT_PAYOUT",
      amountPaise: 150000,
      currency: "INR",
      status: "CONFIRMED",
      requestFingerprint: `fp_${uuidv4()}`,
      providerIdempotencyKey: `idem_${uuidv4()}`,
      correlationId,
      failureMode: null,
      confirmedAt: new Date(),
      supplierId: suppliers[1].id,
    },
  });

  console.log("✅ Created payment intent");

  // Create ledger transaction for the payment
  await prisma.ledgerTransaction.create({
    data: {
      id: uuidv4(),
      referenceType: "PAYMENT_INTENT",
      referenceId: paymentIntentId,
      currency: "INR",
      description: "Discount payout to supplier",
      paymentIntentId,
      entries: {
        create: [
          {
            id: uuidv4(),
            accountCode: "PLATFORM_CASH",
            debitPaise: 150000,
            creditPaise: 0,
          },
          {
            id: uuidv4(),
            accountCode: "SUPPLIER_PAYABLE",
            debitPaise: 0,
            creditPaise: 150000,
          },
        ],
      },
    },
  });

  console.log("✅ Created balanced ledger transaction");

  // Create a dispute case with evidence
  const disputeCase = await prisma.disputeCase.create({
    data: {
      id: uuidv4(),
      providerDisputeId: `disp_demo_${uuidv4().slice(0, 10)}`,
      paymentIntentId: null,
      reasonCode: "PRODUCT_NOT_RECEIVED",
      amountPaise: 50000,
      status: "OPEN",
    },
  });

  // Create evidence documents
  const doc1 = await prisma.evidenceDocument.create({
    data: {
      id: uuidv4(),
      disputeCaseId: disputeCase.id,
      documentType: "DELIVERY_NOTE",
      title: "Delivery Note #DN-2024-001",
      content:
        "Order placed on 2024-08-15. Tracking: TRK-123456. Expected delivery 2024-08-18. Status: Not Received as of 2024-08-22.",
      trustedSource: true,
    },
  });

  const doc2 = await prisma.evidenceDocument.create({
    data: {
      id: uuidv4(),
      disputeCaseId: disputeCase.id,
      documentType: "ORDER_RECORD",
      title: "Order Record #ORD-2024-5678",
      content:
        "Item: Electronics Component. Qty: 100. Amount: ₹50,000. Supplier confirmed shipment on 2024-08-16.",
      trustedSource: true,
    },
  });

  // Create evidence claims
  await Promise.all([
    prisma.evidenceClaim.create({
      data: {
        id: uuidv4(),
        disputeCaseId: disputeCase.id,
        claimText: "Order was not received",
        normalizedField: "delivery_status",
        normalizedValue: "not_received",
        confidence: 0.92,
        sourceDocumentId: doc1.id,
        sourceSpan: "Not Received as of 2024-08-22",
        isContradiction: false,
      },
    }),
    prisma.evidenceClaim.create({
      data: {
        id: uuidv4(),
        disputeCaseId: disputeCase.id,
        claimText: "Supplier confirmed shipment",
        normalizedField: "shipment_status",
        normalizedValue: "shipped",
        confidence: 0.88,
        sourceDocumentId: doc2.id,
        sourceSpan: "Supplier confirmed shipment on 2024-08-16",
        isContradiction: true,
      },
    }),
  ]);

  console.log("✅ Created dispute case with evidence");

  // Create a reconciliation case
  await prisma.reconciliationCase.create({
    data: {
      id: uuidv4(),
      paymentIntentId,
      providerReference: providerPaymentId,
      outcome: "MATCHED",
      severity: "INFO",
      status: "RESOLVED",
      internalAmountPaise: 150000,
      externalAmountPaise: 150000,
      notes: "Provider and internal records match",
      correlationId,
      resolvedAt: new Date(),
    },
  });

  console.log("✅ Created reconciliation case");

  // Create a demo scenario
  await prisma.demoScenario.create({
    data: {
      id: uuidv4(),
      name: "Hero Demo: Timeout After Remote Success",
      description:
        "Demonstrates handling of unknown state when provider confirms but client times out",
      status: "AVAILABLE",
    },
  });

  console.log("✅ Created demo scenario");

  console.log("🎉 Database seeding completed successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
