import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";

/**
 * GET /api/track04/runs
 *
 * Every recorded evaluation, newest first, with the counts of what happened to
 * its exceptions.
 *
 * The version columns are the reason this page exists. A match rate on its own
 * cannot tell you whether a drop came from the data or the code; the same
 * number beside a changed `datasetVersion` means something completely
 * different from the same number beside a changed `controllerVersion`.
 */

export const dynamic = "force-dynamic";

export const GET = withAuth(
  "VIEWER",
  async (request: NextRequest) => {
    try {
      const limit = Math.min(
        Number(new URL(request.url).searchParams.get("limit") ?? 25),
        100
      );

      const runs = await prisma.benchmarkRun.findMany({
        orderBy: { runAt: "desc" },
        take: Number.isFinite(limit) ? limit : 25,
        include: {
          reviews: { select: { status: true } },
        },
      });

      return NextResponse.json(
        successEnvelope({
          runs: runs.map((run) => {
            const open = run.reviews.filter((r) => r.status === "OPEN").length;
            return {
              id: run.id,
              runAt: run.runAt,
              operator: run.operator,
              datasetVersion: run.datasetVersion,
              datasetSeed: run.datasetSeed,
              controllerVersion: run.controllerVersion,
              split: run.split,
              recordsProcessed: run.recordsProcessed,
              matchRate: run.matchRate,
              autoResolutionRate: run.autoResolutionRate,
              exceptionRate: run.exceptionRate,
              autoResolutionPrecision: run.autoResolutionPrecision,
              falseResolutions: run.falseResolutions,
              missedMatches: run.missedMatches,
              recordsPerSecond: run.recordsPerSecond,
              elapsedMs: run.elapsedMs,
              // BigInt is not JSON-serialisable; these totals are far below
              // Number.MAX_SAFE_INTEGER so the narrowing is lossless.
              valueReconciledPaise: Number(run.valueReconciledPaise),
              valueHeldForReviewPaise: Number(run.valueHeldForReviewPaise),
              ledgerBalanced: run.ledgerBalanced,
              ledgerImbalancePaise: Number(run.ledgerImbalancePaise),
              exceptionCount: run.exceptionCount,
              exceptionsOpen: open,
              exceptionsResolved: run.reviews.length - open,
            };
          }),
        })
      );
    } catch (error) {
      console.error("Failed to read benchmark runs:", error);
      return NextResponse.json(
        errorEnvelope("INTERNAL_ERROR", "Failed to read the run history"),
        { status: 500 }
      );
    }
  }
);
