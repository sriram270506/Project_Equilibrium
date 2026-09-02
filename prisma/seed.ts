import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import {
  SUPPLIER_PROFILES,
  generateObservations,
} from "../src/lib/demo/supplier-profiles";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // Clear existing data
  await prisma.user.deleteMany();
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

  // Create demo users
  const users = await Promise.all([
    prisma.user.create({
      data: {
        id: "user_viewer_demo",
        email: "viewer@demo.local",
        name: "Viewer Demo",
        role: "VIEWER",
        apiKey: "key_viewer_demo_12345",
      },
    }),
    prisma.user.create({
      data: {
        id: "user_operator_demo",
        email: "operator@demo.local",
        name: "Operator Demo",
        role: "OPERATOR",
        apiKey: "key_operator_demo_12345",
      },
    }),
    prisma.user.create({
      data: {
        id: "user_approver_demo",
        email: "approver@demo.local",
        name: "Approver Demo",
        role: "APPROVER",
        apiKey: "key_approver_demo_12345",
      },
    }),
    prisma.user.create({
      data: {
        id: "user_admin_demo",
        email: "admin@demo.local",
        name: "Admin Demo",
        role: "ADMIN",
        apiKey: "key_admin_demo_12345",
      },
    }),
  ]);
  console.log(`✅ Created ${users.length} demo users`);

  // Create suppliers and their cash-flow history from shared profiles, so the
  // seed and the demo reset endpoint can never disagree about the cast.
  const suppliers = [];
  const now = new Date();
  let observationCount = 0;

  for (let i = 0; i < SUPPLIER_PROFILES.length; i++) {
    const profile = SUPPLIER_PROFILES[i];

    // Backdate creation so relationship tenure is a real feature, not a constant.
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - (180 + i * 240));

    const supplier = await prisma.supplier.create({
      data: {
        id: uuidv4(),
        name: profile.name,
        email: profile.email,
        riskTier: profile.riskTier,
        createdAt,
      },
    });
    suppliers.push(supplier);

    const observations = generateObservations(profile, i + 1, now);
    for (const observation of observations) {
      await prisma.liquidityObservation.create({
        data: {
          id: uuidv4(),
          supplierId: supplier.id,
          ...observation,
        },
      });
      observationCount++;
    }
  }

  console.log(`✅ Created ${suppliers.length} suppliers`);
  console.log(`✅ Created ${observationCount} liquidity observations`);

  const aarav = suppliers[0];

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
