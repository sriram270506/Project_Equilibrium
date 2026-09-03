import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { publishPendingEvents } from "@/src/lib/events/event-service";
import { createAuditEvent } from "@/src/lib/audit";
import { logger, correlationIdFrom } from "@/src/lib/observability/logger";
import { metrics } from "@/src/lib/observability/metrics";

/**
 * Outbox drain and dead-letter management.
 *
 * GET  — pending and dead-lettered events, so failures are visible rather than
 *        buried in a table nobody queries.
 * POST — drain pending events, or replay a specific dead-lettered one.
 *
 * An event that exhausted its retries is not deleted. It sits in FAILED with
 * its last error until someone looks at it, because a silently dropped
 * financial event is indistinguishable from one that never happened.
 */

export const GET = withAuth("VIEWER", async () => {
  try {
    const [pending, failed, published, deadLetters] = await Promise.all([
      prisma.outboxEvent.count({ where: { status: "PENDING" } }),
      prisma.outboxEvent.count({ where: { status: "FAILED" } }),
      prisma.outboxEvent.count({ where: { status: "PUBLISHED" } }),
      prisma.outboxEvent.findMany({
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const oldestPending = await prisma.outboxEvent.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    return NextResponse.json(
      successEnvelope({
        summary: {
          pending,
          failed,
          published,
          oldestPendingAgeSeconds: oldestPending
            ? Math.floor(
                (Date.now() - oldestPending.createdAt.getTime()) / 1000
              )
            : 0,
        },
        deadLetters: deadLetters.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
          attemptCount: e.attemptCount,
          lastError: e.lastError,
          correlationId: e.correlationId,
          createdAt: e.createdAt,
          ageSeconds: Math.floor((Date.now() - e.createdAt.getTime()) / 1000),
        })),
      })
    );
  } catch (error) {
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", (error as Error).message),
      { status: 500 }
    );
  }
});

const publishSchema = z.object({
  /** Reset one dead-lettered event to PENDING and try again. */
  replayEventId: z.string().min(1).optional(),
  reason: z.string().trim().min(10).max(500).optional(),
});

export const POST = withAuth(
  "OPERATOR",
  async (request: NextRequest, _ctx, auth) => {
    const correlationId = correlationIdFrom(request);
    const log = logger.child({
      correlationId,
      operatorId: auth.userId,
      route: "events/publish",
    });

    try {
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        // An empty body means "just drain".
      }

      const parsed = publishSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return NextResponse.json(
          errorEnvelope("VALIDATION_ERROR", "Invalid request", {
            issues: parsed.error.issues,
          }),
          { status: 400 }
        );
      }

      /* Replay one dead letter ---------------------------------------- */
      if (parsed.data.replayEventId) {
        if (!parsed.data.reason) {
          return NextResponse.json(
            errorEnvelope(
              "VALIDATION_ERROR",
              "Replaying a dead-lettered event requires a reason."
            ),
            { status: 400 }
          );
        }

        const target = await prisma.outboxEvent.findUnique({
          where: { id: parsed.data.replayEventId },
        });

        if (!target) {
          return NextResponse.json(
            errorEnvelope("NOT_FOUND", "No such outbox event"),
            { status: 404 }
          );
        }

        if (target.status !== "FAILED") {
          return NextResponse.json(
            errorEnvelope(
              "INVALID_STATE",
              `Only dead-lettered events can be replayed. This one is ${target.status}.`
            ),
            { status: 409 }
          );
        }

        await prisma.outboxEvent.update({
          where: { id: target.id },
          data: {
            status: "PENDING",
            attemptCount: 0,
            availableAt: new Date(),
            lastError: null,
          },
        });

        await createAuditEvent({
          eventType: "OUTBOX_EVENT_REPLAYED",
          actorType: "OPERATOR",
          actorId: auth.userId,
          aggregateType: "OUTBOX_EVENT",
          aggregateId: target.id,
          payload: {
            reason: parsed.data.reason,
            previous_attempts: target.attemptCount,
            previous_error: target.lastError,
          },
          correlationId: target.correlationId,
        });

        log.info("outbox.replayed", { eventId: target.id });
      }

      /* Drain ---------------------------------------------------------- */
      const before = await prisma.outboxEvent.count({
        where: { status: "PENDING" },
      });

      await metrics.time("outbox.drain", () => publishPendingEvents());

      const [after, failed] = await Promise.all([
        prisma.outboxEvent.count({ where: { status: "PENDING" } }),
        prisma.outboxEvent.count({ where: { status: "FAILED" } }),
      ]);

      metrics.increment("outbox.published", {}, before - after);
      log.info("outbox.drained", { drained: before - after, deadLetters: failed });

      return NextResponse.json(
        successEnvelope({
          drained: before - after,
          stillPending: after,
          deadLettered: failed,
          message:
            failed > 0
              ? `${before - after} published. ${failed} event(s) exhausted their retries and need an operator.`
              : `${before - after} event(s) published.`,
        })
      );
    } catch (error) {
      log.error("outbox.drain_failed", { error: (error as Error).message });
      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to publish events"),
        { status: 500 }
      );
    }
  }
);
