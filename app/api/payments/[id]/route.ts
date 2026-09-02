import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";
import { PAYMENT_TRANSITIONS, PaymentStatus } from "@/src/lib/state-machine";

/**
 * GET /api/payments/:id
 *
 * One payment, end to end: its ledger entries, its audit timeline, the
 * provider's own view of it, any reconciliation cases raised against it, and
 * where it sits in the state machine.
 *
 * The point of gathering all of this on one screen is that "trace this ₹1,500
 * from approval to bank" should take one click, not a database session.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const payment = await prisma.paymentIntent.findUnique({
      where: { id },
      include: {
        supplier: true,
        ledgerTransactions: { include: { entries: true } },
        reconciliationCases: { orderBy: { createdAt: "desc" } },
        outboxEvents: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!payment) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", `No payment with id ${id}`),
        { status: 404 }
      );
    }

    // Audit entries for this payment and for the offer that produced it,
    // linked by correlation id so the operator sees one continuous story.
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        OR: [{ aggregateId: id }, { correlationId: payment.correlationId }],
      },
      orderBy: { sequence: "asc" },
    });

    const eventRecords = await prisma.eventRecord.findMany({
      where: { aggregateId: id },
      orderBy: { sequenceNumber: "asc" },
    });

    // What the provider believes, fetched live for comparison.
    let providerView: {
      status: string;
      amountPaise: number;
      failureMode: string | null;
    } | null = null;

    if (payment.providerPaymentId) {
      const record = await prisma.mockProviderRecord.findUnique({
        where: { providerPaymentId: payment.providerPaymentId },
      });
      if (record) {
        providerView = {
          status: record.status,
          amountPaise: record.amountPaise,
          failureMode: record.failureMode,
        };
      }
    }

    const ledgerEntries = payment.ledgerTransactions.flatMap((t) =>
      t.entries.map((e) => ({
        id: e.id,
        accountCode: e.accountCode,
        debitPaise: e.debitPaise,
        creditPaise: e.creditPaise,
        description: t.description,
      }))
    );

    const totalDebits = ledgerEntries.reduce((s, e) => s + e.debitPaise, 0);
    const totalCredits = ledgerEntries.reduce((s, e) => s + e.creditPaise, 0);

    return NextResponse.json(
      successEnvelope({
        payment: {
          id: payment.id,
          internalReference: payment.internalReference,
          status: payment.status,
          amountPaise: payment.amountPaise,
          amountDisplay: formatPaise(payment.amountPaise),
          currency: payment.currency,
          operationType: payment.operationType,
          provider: payment.provider,
          providerPaymentId: payment.providerPaymentId,
          providerOrderId: payment.providerOrderId,
          providerIdempotencyKey: payment.providerIdempotencyKey,
          requestFingerprint: payment.requestFingerprint,
          correlationId: payment.correlationId,
          failureMode: payment.failureMode,
          makerId: payment.makerId,
          checkerId: payment.checkerId,
          approvalThresholdPaise: payment.approvalThresholdPaise,
          approvedAt: payment.approvedAt,
          createdAt: payment.createdAt,
          confirmedAt: payment.confirmedAt,
          nextStates:
            PAYMENT_TRANSITIONS[payment.status as PaymentStatus] ?? [],
        },
        supplier: {
          id: payment.supplier.id,
          name: payment.supplier.name,
          riskTier: payment.supplier.riskTier,
        },
        ledger: {
          entries: ledgerEntries,
          totalDebits,
          totalCredits,
          balanced: totalDebits === totalCredits,
        },
        providerView,
        agreement: providerView
          ? {
              amountMatches: providerView.amountPaise === payment.amountPaise,
              statusMatches: providerView.status === payment.status,
            }
          : null,
        reconciliationCases: payment.reconciliationCases.map((c) => ({
          id: c.id,
          outcome: c.outcome,
          severity: c.severity,
          status: c.status,
          internalAmountPaise: c.internalAmountPaise,
          externalAmountPaise: c.externalAmountPaise,
          createdAt: c.createdAt,
          resolvedAt: c.resolvedAt,
        })),
        outbox: payment.outboxEvents.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          status: e.status,
          attemptCount: e.attemptCount,
          publishedAt: e.publishedAt,
          lastError: e.lastError,
        })),
        eventLog: eventRecords.map((e) => ({
          sequenceNumber: e.sequenceNumber,
          eventType: e.eventType,
          idempotencyKey: e.idempotencyKey,
          createdAt: e.createdAt,
        })),
        timeline: auditEvents.map((e) => ({
          sequence: e.sequence,
          eventType: e.eventType,
          actorType: e.actorType,
          actorId: e.actorId,
          payload: JSON.parse(e.payloadJson),
          createdAt: e.createdAt,
          entryHash: e.entryHash,
        })),
      })
    );
  } catch (error) {
    console.error("Error fetching payment:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to load the payment"),
      { status: 500 }
    );
  }
}
