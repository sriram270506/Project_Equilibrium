import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";
import { calculateTrialBalance } from "@/src/lib/ledger/trial-balance";
import { NextResponse } from "next/server";

/**
 * Overview metrics.
 *
 * These are deliberately business facts rather than table counts. "Three
 * suppliers would have missed payroll this week" is a sentence someone can act
 * on; "3 LiquidityOpportunity rows with status RECOMMENDED" is not.
 */
export async function GET() {
  try {
    const [
      atRiskOpportunities,
      approvedOpportunities,
      paymentsByStatus,
      confirmedPayments,
      openExceptions,
      criticalExceptions,
      recentPayments,
      pendingOutbox,
      trialBalance,
    ] = await Promise.all([
      prisma.liquidityOpportunity.findMany({
        where: { status: "RECOMMENDED" },
        include: { supplier: true },
        orderBy: { predictionProbability: "desc" },
      }),
      prisma.liquidityOpportunity.count({
        where: { status: { in: ["APPROVED", "EXECUTED"] } },
      }),
      prisma.paymentIntent.groupBy({ by: ["status"], _count: true }),
      prisma.paymentIntent.findMany({
        where: { status: "CONFIRMED" },
        select: { amountPaise: true, supplierId: true },
      }),
      prisma.reconciliationCase.count({
        where: { status: { in: ["OPEN", "INVESTIGATING"] } },
      }),
      prisma.reconciliationCase.count({
        where: {
          status: { in: ["OPEN", "INVESTIGATING"] },
          severity: "CRITICAL",
        },
      }),
      prisma.paymentIntent.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: { supplier: true },
      }),
      prisma.outboxEvent.count({ where: { status: "PENDING" } }),
      calculateTrialBalance(),
    ]);

    const cashAdvancedPaise = confirmedPayments.reduce(
      (sum, p) => sum + p.amountPaise,
      0
    );
    const suppliersHelped = new Set(confirmedPayments.map((p) => p.supplierId))
      .size;

    // The headline: how much shortfall are we looking at right now?
    const atRiskExposurePaise = atRiskOpportunities.reduce(
      (sum, o) => sum + o.expectedBenefitPaise,
      0
    );

    const mostUrgent = atRiskOpportunities[0] ?? null;

    // Payments that need a human: stuck in a non-terminal state.
    const needsAttention = paymentsByStatus
      .filter((g) => ["UNKNOWN", "MANUAL_REVIEW", "PENDING_APPROVAL"].includes(g.status))
      .reduce((sum, g) => sum + g._count, 0);

    return NextResponse.json(
      successEnvelope({
        headline: {
          suppliersAtRisk: atRiskOpportunities.length,
          atRiskExposurePaise,
          atRiskExposureDisplay: formatPaise(atRiskExposurePaise),
          mostUrgent: mostUrgent
            ? {
                opportunityId: mostUrgent.id,
                supplierName: mostUrgent.supplier.name,
                probability: mostUrgent.predictionProbability,
                amountPaise: mostUrgent.expectedBenefitPaise,
              }
            : null,
        },
        kpis: {
          suppliersAtRisk: atRiskOpportunities.length,
          offersApproved: approvedOpportunities,
          cashAdvancedPaise,
          cashAdvancedDisplay: formatPaise(cashAdvancedPaise),
          suppliersHelped,
          openExceptions,
          criticalExceptions,
          paymentsNeedingAttention: needsAttention,
          pendingOutboxEvents: pendingOutbox,
        },
        integrity: {
          ledgerBalanced: trialBalance.balanced,
          totalDebitsPaise: trialBalance.totalDebits,
          totalCreditsPaise: trialBalance.totalCredits,
          netPaise: trialBalance.net,
          accountCount: trialBalance.accounts.length,
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
          correlationId: p.correlationId,
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
