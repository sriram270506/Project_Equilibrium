import { NextRequest, NextResponse } from "next/server";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import { runAndRecord } from "@/src/lib/track04/run-service";

/**
 * POST /api/track04/run
 *
 * The one-click evaluation: build the dataset, score it, persist the run, and
 * open a review row for every record the controller would not clear.
 *
 * Requires OPERATOR because it writes. The read-only `GET /api/track04` stays
 * open — looking at a score is not the same as recording one, and a run row
 * signed by nobody would defeat the point of storing the operator at all.
 */

export const dynamic = "force-dynamic";

export const POST = withAuth(
  "OPERATOR",
  async (_request: NextRequest, _context: unknown, auth) => {
    try {
      const result = await runAndRecord({
        operator: auth.userId ?? "unknown-operator",
        split: "HELD_OUT",
      });

      return NextResponse.json(
        successEnvelope({
          runId: result.runId,
          reviewsOpened: result.reviewsOpened,
          ledger: result.ledger,
          summary: {
            recordsProcessed: result.report.recordsProcessed,
            correctlyResolved: result.report.correctlyResolved,
            matchRate: result.report.matchRate,
            autoResolutionPrecision: result.report.autoResolutionPrecision,
            falseResolutions: result.report.falseResolutions,
            exceptionCount: result.report.exceptions.length,
            recordsPerSecond: result.report.recordsPerSecond,
            elapsedMs: result.report.elapsedMs,
            valueReconciledPaise: result.report.valueReconciledPaise,
          },
        })
      );
    } catch (error) {
      console.error("Track 04 run failed:", error);
      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to run the Track 04 evaluation"),
        { status: 500 }
      );
    }
  }
);
