import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { assertDemoMode } from "@/src/lib/env";
import { withAuth } from "@/src/lib/auth/guard";
import { mockRazorpay, FailureMode } from "@/src/lib/payments/mock-razorpay";
import {
  approveOpportunity,
  confirmSecondApproval,
} from "@/src/server/opportunity-service";
import {
  submitPaymentToProvider,
  simulateWebhook,
} from "@/src/lib/payments/payment-service";
import { RiskControlError } from "@/src/lib/risk/controls";
import { formatPaise } from "@/src/lib/money";

/**
 * POST /api/demo/inject
 *
 * Deliberately break the payment provider in a chosen way, then report what the
 * system did about it.
 *
 * Every distributed payments system claims to handle these cases. This endpoint
 * exists so the claim can be exercised on demand rather than described.
 */

const injectSchema = z.object({
  failure: z.enum([
    "success",
    "timeout_after_remote_success",
    "timeout_before_processing",
    "provider_decline",
    "duplicate_webhook",
  ]),
});

const EXPECTED: Record<string, { expectation: string; whyItMatters: string }> = {
  success: {
    expectation: "Payment confirms on the first attempt.",
    whyItMatters: "The control case, for comparison against the failures.",
  },
  timeout_after_remote_success: {
    expectation:
      "Recorded as UNKNOWN. The provider did commit the payment, but we never received the answer, so we refuse to assume either way.",
    whyItMatters:
      "The failure that causes double payments in real systems. Retrying pays twice; marking it failed loses the money. Only reconciliation can settle it.",
  },
  timeout_before_processing: {
    expectation:
      "Recorded as UNKNOWN. The provider never processed it, but from our side that is indistinguishable from the case above.",
    whyItMatters:
      "Two very different realities look identical to the caller. That is precisely why we record uncertainty instead of guessing.",
  },
  provider_decline: {
    expectation: "Recorded as FAILED. No money moved and the ledger still foots.",
    whyItMatters:
      "A clean decline is the easy case, but the ledger entries still have to balance for it.",
  },
  duplicate_webhook: {
    expectation:
      "The same provider event is delivered twice. The second delivery is recognised as a replay and changes nothing.",
    whyItMatters:
      "Providers guarantee at-least-once webhook delivery, never exactly-once. A receiver that is not idempotent silently doubles its accounting.",
  },
};

export const POST = withAuth("OPERATOR", async (request: NextRequest, _ctx, auth) => {
  try {
    assertDemoMode();

    const parsed = injectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        errorEnvelope("VALIDATION_ERROR", "Unknown failure mode", {
          issues: parsed.error.issues,
        }),
        { status: 400 }
      );
    }

    const failure = parsed.data.failure;
    const meta = EXPECTED[failure];

    /* -------------------------------------------- duplicate webhook path */
    if (failure === "duplicate_webhook") {
      const payment = await prisma.paymentIntent.findFirst({
        where: { status: "CONFIRMED", providerPaymentId: { not: null } },
        orderBy: { createdAt: "desc" },
        include: { supplier: true },
      });

      if (!payment) {
        return NextResponse.json(
          errorEnvelope(
            "NO_SUBJECT",
            "No confirmed payment available to receive a webhook. Approve an offer first."
          ),
          { status: 409 }
        );
      }

      const eventsBefore = await prisma.eventRecord.count();
      await simulateWebhook(payment.id);
      await simulateWebhook(payment.id);
      const eventsAfter = await prisma.eventRecord.count();

      const after = await prisma.paymentIntent.findUnique({
        where: { id: payment.id },
      });

      return NextResponse.json(
        successEnvelope({
          failure,
          ...meta,
          supplierName: payment.supplier.name,
          paymentIntentId: payment.id,
          observed: {
            deliveries: 2,
            netNewEventRecords: eventsAfter - eventsBefore,
            finalStatus: after?.status ?? "unknown",
            amountDisplay: formatPaise(payment.amountPaise),
          },
          survived: eventsAfter - eventsBefore === 0,
          verdict:
            eventsAfter - eventsBefore === 0
              ? "The replay was discarded. Nothing changed."
              : "A duplicate slipped through - the event log grew when it should not have.",
        })
      );
    }

    /* ------------------------------------------------- payment failure path */
    const opportunity = await prisma.liquidityOpportunity.findFirst({
      where: { status: "RECOMMENDED" },
      orderBy: { predictionProbability: "desc" },
      include: { supplier: true },
    });

    if (!opportunity) {
      return NextResponse.json(
        errorEnvelope(
          "NO_SUBJECT",
          "No recommended offer available. Run the scoring step on the walkthrough first."
        ),
        { status: 409 }
      );
    }

    const approval = await approveOpportunity(opportunity.id, auth.userId);

    /*
     * Large advances are held for a second approver. Clear that gate here with
     * a distinct checker so the failure the operator actually asked for gets
     * exercised - otherwise clicking "inject a timeout" would silently return
     * "maker-checker fired instead", which is not what they wanted to test.
     */
    let clearedDualApproval = false;
    if (approval.requiresDualApproval) {
      // Roles live on the membership now, so find an APPROVER membership in
      // the same tenant rather than an "approver user" globally.
      const checkerMembership = await prisma.tenantUser.findFirst({
        where: {
          role: "APPROVER",
          isActive: true,
          userId: { not: auth.userId },
          user: { isActive: true },
        },
        include: { user: true },
      });
      const checker = checkerMembership?.user ?? null;

      if (!checker) {
        return NextResponse.json(
          errorEnvelope(
            "NO_APPROVER",
            "This advance needs a second approver and no other approver account exists."
          ),
          { status: 409 }
        );
      }

      await confirmSecondApproval(approval.paymentIntentId, checker.id);
      clearedDualApproval = true;
    }

    mockRazorpay.setFailureMode(failure as FailureMode);
    const status = await submitPaymentToProvider(approval.paymentIntentId);

    const expectedStatus =
      failure === "success"
        ? "CONFIRMED"
        : failure === "provider_decline"
          ? "FAILED"
          : "UNKNOWN";

    // Confirm the books still balance after the failure.
    const entries = await prisma.ledgerEntry.findMany();
    const debits = entries.reduce((s, e) => s + e.debitPaise, 0);
    const credits = entries.reduce((s, e) => s + e.creditPaise, 0);

    return NextResponse.json(
      successEnvelope({
        failure,
        ...meta,
        supplierName: opportunity.supplier.name,
        paymentIntentId: approval.paymentIntentId,
        correlationId: approval.correlationId,
        observed: {
          finalStatus: status,
          expectedStatus,
          ...(clearedDualApproval
            ? { secondApprovalRequired: true }
            : {}),
          amountDisplay: formatPaise(opportunity.expectedBenefitPaise),
          ledgerBalanced: debits === credits,
          totalDebitsDisplay: formatPaise(debits),
          totalCreditsDisplay: formatPaise(credits),
        },
        survived: status === expectedStatus && debits === credits,
        verdict:
          status === expectedStatus
            ? `Recorded as ${status}, as designed, and the ledger still foots.`
            : `Expected ${expectedStatus} but recorded ${status}. That is a bug worth investigating.`,
      })
    );
  } catch (error) {
    if (error instanceof RiskControlError) {
      return NextResponse.json(
        errorEnvelope("RISK_CONTROL_BLOCKED", error.message, {
          violations: error.violations,
        }),
        { status: 409 }
      );
    }
    const message = (error as Error).message;
    if (message.includes("demo mode")) {
      return NextResponse.json(errorEnvelope("FORBIDDEN", message), {
        status: 403,
      });
    }
    console.error("Failure injection error:", error);
    return NextResponse.json(errorEnvelope("STEP_FAILED", message), {
      status: 409,
    });
  }
});
