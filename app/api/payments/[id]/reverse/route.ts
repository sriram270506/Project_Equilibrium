import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { createAuditEvent } from "@/src/lib/audit";
import { assertPaymentTransition, PaymentStatus } from "@/src/lib/state-machine";
import {
  buildReversalJournal,
  assertJournalBalanced,
  type JournalLeg,
} from "@/src/lib/ledger/accounts";
import { calculateTrialBalance } from "@/src/lib/ledger/trial-balance";
import { generateId } from "@/src/lib/ids";
import { logger, correlationIdFrom } from "@/src/lib/observability/logger";
import { metrics } from "@/src/lib/observability/metrics";

/**
 * POST /api/payments/:id/reverse
 *
 * Undo a confirmed payment by POSTING THE OPPOSITE ENTRIES, never by editing
 * or deleting the original.
 *
 * This is the difference between an accounting system and a database with
 * money-shaped columns. Deleting the original would make the books balance
 * again, but it would also erase the fact that a payment was made and reversed
 * — and an auditor asking "what did you believe on Tuesday?" would get an
 * answer that has been quietly rewritten.
 *
 * After the reversal, every touched account nets to zero and the trial balance
 * still foots. The history shows both events.
 */

const reverseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(15, "Give a reason of at least 15 characters explaining the reversal.")
    .max(500),
});

export const POST = withAuth<{ params: Promise<{ id: string }> }>(
  "APPROVER",
  async (request: NextRequest, { params }, auth) => {
    const correlationId = correlationIdFrom(request);
    const log = logger.child({
      correlationId,
      operatorId: auth.userId,
      route: "payments/reverse",
    });

    try {
      const { id } = await params;
      const parsed = reverseSchema.safeParse(await request.json());

      if (!parsed.success) {
        return NextResponse.json(
          errorEnvelope("VALIDATION_ERROR", "A substantive reason is required", {
            issues: parsed.error.issues,
          }),
          { status: 400 }
        );
      }

      const payment = await prisma.paymentIntent.findFirst({
        where: { id, tenantId: auth.tenantId },
        include: { ledgerTransactions: { include: { entries: true } } },
      });

      if (!payment) {
        return NextResponse.json(
          errorEnvelope("NOT_FOUND", `No payment ${id} in this tenant`),
          { status: 404 }
        );
      }

      // The state machine decides what may be reversed, not this handler.
      try {
        assertPaymentTransition(
          payment.status as PaymentStatus,
          "REVERSED" as PaymentStatus
        );
      } catch (error) {
        return NextResponse.json(
          errorEnvelope("INVALID_STATE", (error as Error).message),
          { status: 409 }
        );
      }

      const originalLegs: JournalLeg[] = payment.ledgerTransactions.flatMap(
        (txn) =>
          txn.entries.map((entry) => ({
            accountCode: entry.accountCode,
            debitPaise: entry.debitPaise,
            creditPaise: entry.creditPaise,
            memo: txn.description,
          }))
      );

      if (originalLegs.length === 0) {
        return NextResponse.json(
          errorEnvelope(
            "NOTHING_TO_REVERSE",
            "This payment has no ledger entries to reverse."
          ),
          { status: 409 }
        );
      }

      const reversalLegs = buildReversalJournal(originalLegs);
      // Belt and braces: the builder already asserts, but an unbalanced
      // reversal reaching the database would be unrecoverable.
      assertJournalBalanced(reversalLegs);

      const balanceBefore = await calculateTrialBalance();

      await prisma.$transaction(async (tx) => {
        await tx.ledgerTransaction.create({
          data: {
            id: generateId(),
            referenceType: "PAYMENT_REVERSAL",
            referenceId: payment.id,
            currency: payment.currency,
            description: `Reversal of payment ${payment.internalReference}: ${parsed.data.reason}`,
            paymentIntentId: payment.id,
            entries: {
              create: reversalLegs.map((leg) => ({
                id: generateId(),
                accountCode: leg.accountCode,
                debitPaise: leg.debitPaise,
                creditPaise: leg.creditPaise,
              })),
            },
          },
        });

        await tx.paymentIntent.update({
          where: { id: payment.id },
          data: { status: "REVERSED" },
        });

        await createAuditEvent(
          {
            tenantId: auth.tenantId,
            eventType: "PAYMENT_REVERSED",
            actorType: "OPERATOR",
            actorId: auth.userId,
            aggregateType: "PAYMENT_INTENT",
            aggregateId: payment.id,
            payload: {
              reason: parsed.data.reason,
              amount_paise: payment.amountPaise,
              reversal_legs: reversalLegs.length,
              previous_status: payment.status,
            },
            correlationId: payment.correlationId,
            supplierId: payment.supplierId,
          },
          tx
        );
      });

      const balanceAfter = await calculateTrialBalance();

      // Net position per account, so the UI can show the books returning to
      // zero rather than merely asserting that they did.
      const netByAccount = new Map<string, number>();
      for (const leg of [...originalLegs, ...reversalLegs]) {
        netByAccount.set(
          leg.accountCode,
          (netByAccount.get(leg.accountCode) ?? 0) +
            leg.debitPaise -
            leg.creditPaise
        );
      }

      const allNetZero = [...netByAccount.values()].every((v) => v === 0);

      metrics.increment("payment.reversed");
      log.info("payment.reversed", {
        paymentIntentId: payment.id,
        legs: reversalLegs.length,
        allNetZero,
      });

      return NextResponse.json(
        successEnvelope({
          paymentIntentId: payment.id,
          status: "REVERSED",
          reversedBy: auth.name,
          reason: parsed.data.reason,
          reversalLegs,
          netByAccount: [...netByAccount.entries()].map(([code, net]) => ({
            accountCode: code,
            netPaise: net,
          })),
          allAccountsNetZero: allNetZero,
          trialBalance: {
            beforeDebits: balanceBefore.totalDebits,
            beforeCredits: balanceBefore.totalCredits,
            afterDebits: balanceAfter.totalDebits,
            afterCredits: balanceAfter.totalCredits,
            stillBalanced: balanceAfter.balanced,
          },
          message:
            "Reversed by posting opposite entries. The original transaction is untouched, and both events remain in the history.",
        })
      );
    } catch (error) {
      log.error("payment.reverse_failed", { error: (error as Error).message });
      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to reverse the payment"),
        { status: 500 }
      );
    }
  }
);
