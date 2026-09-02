import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { verifyAuditChain } from "@/src/lib/audit";
import { assertDemoMode } from "@/src/lib/env";

/** GET /api/audit — the chain, plus a live verification of it. */
export const GET = withAuth("VIEWER", async (request: NextRequest) => {
  try {
    const limit = Math.min(
      Number(new URL(request.url).searchParams.get("limit") ?? 50),
      200
    );

    const [verification, entries, total] = await Promise.all([
      verifyAuditChain(),
      prisma.auditEvent.findMany({
        orderBy: { sequence: "desc" },
        take: limit,
      }),
      prisma.auditEvent.count(),
    ]);

    return NextResponse.json(
      successEnvelope({
        verification,
        total,
        entries: entries.map((e) => ({
          id: e.id,
          sequence: e.sequence,
          eventType: e.eventType,
          actorType: e.actorType,
          actorId: e.actorId,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
          payload: JSON.parse(e.payloadJson),
          correlationId: e.correlationId,
          createdAt: e.createdAt,
          previousHash: e.previousHash,
          entryHash: e.entryHash,
        })),
      })
    );
  } catch (error) {
    console.error("Error reading audit log:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to read the audit log"),
      { status: 500 }
    );
  }
});

const tamperSchema = z.object({
  sequence: z.number().int().min(1),
  newActorId: z.string().min(1).max(120).optional(),
});

/**
 * POST /api/audit/tamper — deliberately corrupt one entry.
 *
 * This exists so the tamper-evidence claim can be demonstrated rather than
 * asserted: edit a historical row the way an attacker with database access
 * would, then re-verify and watch the chain report exactly which entry broke.
 *
 * Demo mode only, for obvious reasons.
 */
export const POST = withAuth("ADMIN", async (request: NextRequest) => {
  try {
    assertDemoMode();

    const parsed = tamperSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        errorEnvelope("VALIDATION_ERROR", "Provide the sequence to tamper with", {
          issues: parsed.error.issues,
        }),
        { status: 400 }
      );
    }

    const target = await prisma.auditEvent.findUnique({
      where: { sequence: parsed.data.sequence },
    });

    if (!target) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", `No audit entry at sequence ${parsed.data.sequence}`),
        { status: 404 }
      );
    }

    // Rewrite history the way someone covering their tracks would: change the
    // actor, leave the recorded hash alone.
    await prisma.auditEvent.update({
      where: { id: target.id },
      data: {
        actorId: parsed.data.newActorId ?? "attacker@example.com",
      },
    });

    const verification = await verifyAuditChain();

    return NextResponse.json(
      successEnvelope({
        tamperedSequence: parsed.data.sequence,
        originalActor: target.actorId,
        verification,
        message:
          "One historical entry was edited directly in the database. The chain now reports where.",
      })
    );
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("demo mode")) {
      return NextResponse.json(errorEnvelope("FORBIDDEN", message), {
        status: 403,
      });
    }
    console.error("Error tampering with audit log:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to tamper with the audit log"),
      { status: 500 }
    );
  }
});
