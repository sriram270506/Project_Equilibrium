import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { createAuditEvent } from "@/src/lib/audit";
import { assertReconciliationTransition } from "@/src/lib/state-machine";
import { logger, correlationIdFrom } from "@/src/lib/observability/logger";
import { metrics } from "@/src/lib/observability/metrics";

/**
 * POST /api/reconciliation/:id/resolve
 *
 * An operator closing out an exception. Three properties matter:
 *
 *   1. A reason is MANDATORY. "Resolved" with no explanation is how a
 *      discrepancy gets buried rather than fixed.
 *   2. The operator's identity comes from their credential, never the body.
 *   3. Financial records are never silently overwritten. Resolving a case
 *      records a judgement about a discrepancy; it does not edit the payment
 *      or the ledger.
 */

const resolveSchema = z.object({
  resolution: z.enum(["ACCEPT", "INVESTIGATE", "FREEZE"]),
  /** Long enough to be a real explanation, not a shrug. */
  reason: z
    .string()
    .trim()
    .min(15, "Give a reason of at least 15 characters explaining the decision.")
    .max(1000),
});

export const POST = withAuth<{ params: Promise<{ id: string }> }>(
  "OPERATOR",
  async (request: NextRequest, { params }, auth) => {
    const correlationId = correlationIdFrom(request);
    const log = logger.child({
      correlationId,
      operatorId: auth.userId,
      route: "reconciliation/resolve",
    });

    try {
      const { id } = await params;
      const parsed = resolveSchema.safeParse(await request.json());

      if (!parsed.success) {
        return NextResponse.json(
          errorEnvelope(
            "VALIDATION_ERROR",
            "A resolution and a substantive reason are both required.",
            { issues: parsed.error.issues }
          ),
          { status: 400 }
        );
      }

      const existing = await prisma.reconciliationCase.findUnique({
        where: { id },
      });

      if (!existing) {
        return NextResponse.json(
          errorEnvelope("NOT_FOUND", `No reconciliation case ${id}`),
          { status: 404 }
        );
      }

      const nextStatus =
        parsed.data.resolution === "FREEZE"
          ? "FROZEN"
          : parsed.data.resolution === "INVESTIGATE"
            ? "INVESTIGATING"
            : "RESOLVED";

      try {
        assertReconciliationTransition(
          existing.status as "OPEN" | "INVESTIGATING" | "RESOLVED" | "FROZEN",
          nextStatus as "OPEN" | "INVESTIGATING" | "RESOLVED" | "FROZEN"
        );
      } catch (error) {
        return NextResponse.json(
          errorEnvelope("INVALID_STATE", (error as Error).message),
          { status: 409 }
        );
      }

      const stamp = new Date().toISOString();
      const noteLine = `${stamp} ${auth.name} (${auth.role}) → ${parsed.data.resolution}: ${parsed.data.reason}`;

      await prisma.$transaction(async (tx) => {
        await tx.reconciliationCase.update({
          where: { id },
          data: {
            status: nextStatus,
            // Append rather than replace: the history of judgements is itself
            // audit evidence.
            notes: existing.notes ? `${existing.notes}\n${noteLine}` : noteLine,
            resolvedAt: nextStatus === "RESOLVED" ? new Date() : null,
          },
        });

        await createAuditEvent(
          {
            eventType: "RECONCILIATION_RESOLVED",
            actorType: "OPERATOR",
            actorId: auth.userId,
            aggregateType: "RECONCILIATION_CASE",
            aggregateId: id,
            payload: {
              resolution: parsed.data.resolution,
              reason: parsed.data.reason,
              from_status: existing.status,
              to_status: nextStatus,
              outcome: existing.outcome,
              severity: existing.severity,
              internal_amount_paise: existing.internalAmountPaise,
              external_amount_paise: existing.externalAmountPaise,
            },
            correlationId: existing.correlationId,
          },
          tx
        );
      });

      metrics.increment("reconciliation.resolved", {
        resolution: parsed.data.resolution,
        severity: existing.severity,
      });
      log.info("reconciliation.resolved", {
        caseId: id,
        from: existing.status,
        to: nextStatus,
      });

      return NextResponse.json(
        successEnvelope({
          caseId: id,
          status: nextStatus,
          resolvedBy: auth.name,
          message:
            nextStatus === "RESOLVED"
              ? "Case closed. The reason is recorded in the audit chain."
              : `Case moved to ${nextStatus}.`,
        })
      );
    } catch (error) {
      log.error("reconciliation.resolve_failed", {
        error: (error as Error).message,
      });
      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to resolve the case"),
        { status: 500 }
      );
    }
  }
);
