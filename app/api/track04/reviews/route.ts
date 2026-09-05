import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import {
  recordReview,
  reopenReview,
  evidenceFor,
  REVIEW_ACTIONS,
  type ReviewAction,
} from "@/src/lib/track04/run-service";

/**
 * The human review queue.
 *
 *   GET  /api/track04/reviews?runId=...&status=OPEN
 *   POST /api/track04/reviews
 *
 * This is where the controller's abstentions get resolved. The controller is
 * deliberately unable to close these itself — an exception it could close
 * would not have been an exception — so every transition here is attributed to
 * a person and timestamped.
 */

export const dynamic = "force-dynamic";

export const GET = withAuth("VIEWER", async (request: NextRequest) => {
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");
    const status = url.searchParams.get("status");

    // Default to the most recent run, so the queue is never empty by accident.
    const targetRunId =
      runId ??
      (
        await prisma.benchmarkRun.findFirst({
          orderBy: { runAt: "desc" },
          select: { id: true },
        })
      )?.id;

    if (!targetRunId) {
      return NextResponse.json(
        successEnvelope({
          runId: null,
          reviews: [],
          actions: REVIEW_ACTIONS,
          message:
            "No evaluation has been recorded yet. Run one from the Track 04 dashboard.",
        })
      );
    }

    const reviews = await prisma.exceptionReview.findMany({
      where: {
        runId: targetRunId,
        ...(status && status !== "ALL" ? { status } : {}),
      },
      orderBy: [{ status: "asc" }, { amountPaise: "desc" }],
      take: 200,
    });

    /*
     * Attach the evidence trail for each row. It is rebuilt from the dataset
     * rather than stored: the dataset is deterministic and versioned, so
     * regenerating is exact, and duplicating every candidate record into the
     * database would mean two sources of truth that can disagree.
     */
    const withEvidence = reviews.map((review) => {
      const evidence = evidenceFor(review.recordId);
      return {
        ...review,
        evidence: evidence
          ? {
              scenario: evidence.record.scenario,
              groundTruthLabel: evidence.record.groundTruth.label,
              groundTruthNote: evidence.record.groundTruth.note,
              materialityPaise: evidence.record.groundTruth.materialityPaise,
              internal: evidence.record.internal,
              externals: evidence.record.externals,
              comparisons: evidence.decision.comparisons,
              trace: evidence.decision.trace,
              outcome: evidence.decision.outcome,
            }
          : null,
      };
    });

    return NextResponse.json(
      successEnvelope({
        runId: targetRunId,
        reviews: withEvidence,
        actions: REVIEW_ACTIONS,
        counts: {
          open: withEvidence.filter((r) => r.status === "OPEN").length,
          total: withEvidence.length,
        },
      })
    );
  } catch (error) {
    console.error("Failed to read the review queue:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to read the review queue"),
      { status: 500 }
    );
  }
});

const ReviewBody = z.object({
  reviewId: z.string().min(1),
  action: z.enum([
    "ACCEPTED",
    "REJECTED",
    "RELINKED",
    "MARKED_DUPLICATE",
    "FROZEN",
    "REOPEN",
  ]),
  note: z.string().max(2000).optional(),
  linkedExternalId: z.string().max(200).optional(),
});

export const POST = withAuth(
  "OPERATOR",
  async (request: NextRequest, _context: unknown, auth) => {
    try {
      const parsed = ReviewBody.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json(
          errorEnvelope(
            "VALIDATION_ERROR",
            parsed.error.issues.map((i) => i.message).join("; ")
          ),
          { status: 400 }
        );
      }

      const reviewerId = auth.userId ?? "unknown-operator";
      const { reviewId, action, note, linkedExternalId } = parsed.data;

      if (action === "REOPEN") {
        const reopened = await reopenReview(reviewId, reviewerId);
        return NextResponse.json(successEnvelope({ review: reopened }));
      }

      const updated = await recordReview({
        reviewId,
        action: action as ReviewAction,
        reviewerId,
        note,
        linkedExternalId,
      });

      return NextResponse.json(successEnvelope({ review: updated }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to record the review";
      /*
       * A rejected review is a rule being enforced (a missing note, a record
       * already resolved), not a server fault. Returning 400 with the actual
       * sentence lets the UI show the operator what to fix.
       */
      return NextResponse.json(errorEnvelope("VALIDATION_ERROR", message), {
        status: 400,
      });
    }
  }
);
