import { NextResponse } from "next/server";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import {
  buildDataset,
  datasetSummary,
  DATASET_SEED,
  DATASET_VERSION,
} from "@/src/lib/track04/dataset";
import { evaluate } from "@/src/lib/track04/evaluate";
import {
  processRecord,
  CONTROLLER_VERSION,
  THRESHOLDS,
} from "@/src/lib/track04/controller";

/**
 * GET /api/track04
 *
 * Runs the finance-operations benchmark and returns the report.
 *
 * Deliberately computed on every request rather than read from a stored
 * result. The whole run takes single-digit milliseconds, and a dashboard
 * serving a cached number cannot tell you whether the controller still passes
 * — it tells you it passed once. The point of the page is that the figure on
 * screen was produced by the code currently in the repository.
 *
 * No auth guard: it reads no tenant data and touches no database. Every record
 * it processes is generated in-process from a fixed seed.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const records = buildDataset(DATASET_SEED);
    const heldOut = records.filter((r) => r.split === "HELD_OUT");
    const tuning = records.filter((r) => r.split === "TUNING");

    const report = evaluate(heldOut, {
      datasetVersion: DATASET_VERSION,
      datasetSeed: DATASET_SEED,
      split: "HELD_OUT",
    });
    const tuningReport = evaluate(tuning, {
      datasetVersion: DATASET_VERSION,
      datasetSeed: DATASET_SEED,
      split: "TUNING",
    });
    const baseline = evaluate(heldOut, {
      datasetVersion: DATASET_VERSION,
      datasetSeed: DATASET_SEED,
      split: "HELD_OUT",
      useBaseline: true,
    });

    /*
     * Full evidence for the escalated records, so the UI can open one and show
     * the field-by-field comparison that produced the decision rather than
     * just the headline. Capped so a single response cannot balloon.
     */
    const evidence = heldOut
      .map((record) => ({ record, decision: processRecord(record) }))
      .filter(({ decision }) => decision.outcome !== "AUTO_RESOLVED")
      .sort((a, b) => b.decision.amountPaise - a.decision.amountPaise)
      .slice(0, 60)
      .map(({ record, decision }) => ({
        recordId: record.recordId,
        scenario: record.scenario,
        difficulty: record.difficulty,
        groundTruthLabel: record.groundTruth.label,
        groundTruthNote: record.groundTruth.note,
        materialityPaise: record.groundTruth.materialityPaise,
        internal: record.internal,
        externals: record.externals,
        decision,
      }));

    return NextResponse.json(
      successEnvelope({
        dataset: datasetSummary(records),
        controllerVersion: CONTROLLER_VERSION,
        thresholds: THRESHOLDS,
        heldOut: report,
        tuning: {
          matchRate: tuningReport.matchRate,
          recordsProcessed: tuningReport.recordsProcessed,
        },
        baseline: {
          matchRate: baseline.matchRate,
          autoResolutionRate: baseline.autoResolutionRate,
          falseResolutions: baseline.falseResolutions,
          valueReconciledPaise: baseline.valueReconciledPaise,
        },
        evidence,
      })
    );
  } catch (error) {
    console.error("Track 04 benchmark failed:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to run the Track 04 benchmark"),
      { status: 500 }
    );
  }
}
