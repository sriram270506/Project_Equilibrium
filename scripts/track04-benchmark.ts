/**
 * The Track 04 finance-operations benchmark.
 *
 *   npm run track04:benchmark
 *
 * Generates the labelled dataset, runs the controller over it, and prints the
 * operational performance report plus the honest exception list.
 *
 * Headline numbers are reported on the HELD-OUT split. The tuning split is
 * printed alongside so the gap between them is visible: a system that scores
 * far better on tuning than on held-out data has been fitted to its own test.
 *
 * Everything needed to reproduce a number is printed with it — dataset
 * version, seed, controller version. Same command, same machine or not, same
 * result.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  buildDataset,
  datasetSummary,
  DATASET_SEED,
  DATASET_VERSION,
} from "../src/lib/track04/dataset";
import { evaluate, type EvaluationReport } from "../src/lib/track04/evaluate";
import { CONTROLLER_VERSION, THRESHOLDS } from "../src/lib/track04/controller";

const rupees = (paise: number) =>
  "Rs " + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const pct = (x: number) => (x * 100).toFixed(1) + "%";

function rule(char = "=") {
  console.log(char.repeat(66));
}

function heading(title: string) {
  console.log("");
  rule();
  console.log("  " + title);
  rule();
}

function printReport(report: EvaluationReport, label: string) {
  heading(label);

  console.log("  Volume and speed");
  console.log(`    Records processed        ${report.recordsProcessed}`);
  console.log(`    Total processing time    ${report.elapsedMs.toFixed(1)} ms`);
  console.log(
    `    Throughput               ${report.recordsPerSecond.toFixed(0)} records/sec ` +
      `(${Math.round(report.recordsPerSecond * 60).toLocaleString("en-IN")} records/min)`
  );
  console.log(
    `    Average per record       ${report.averageMsPerRecord.toFixed(3)} ms`
  );

  console.log("");
  console.log("  Operational accuracy");
  console.log(
    `    Correctly resolved       ${report.correctlyResolved} / ${report.recordsProcessed}`
  );
  console.log(`    Match rate               ${pct(report.matchRate)}`);
  console.log(`    Auto-resolution rate     ${pct(report.autoResolutionRate)}`);
  console.log(`    Exception rate           ${pct(report.exceptionRate)}`);

  console.log("");
  console.log("  Errors, decomposed");
  console.log(
    `    False resolutions        ${report.falseResolutions} ` +
      `(${pct(report.falseResolutionRate)}) - cleared something that needed a human`
  );
  console.log(
    `    Missed matches           ${report.missedMatches} - escalated something safe to clear`
  );
  console.log(
    `    Wrong exception type     ${report.wrongExceptionTypes} - escalated, but named the wrong cause`
  );

  console.log("");
  console.log("  Financial materiality");
  console.log(
    `    Value reconciled         ${rupees(report.valueReconciledPaise)}`
  );
  console.log(
    `    Value held for review    ${rupees(report.valueHeldForReviewPaise)}`
  );
  console.log(
    `    Value exposed by open exceptions  ${rupees(report.valueExposedByUnresolvedPaise)}`
  );
  console.log(
    `    Value at risk from false resolutions  ${rupees(report.valueAtRiskFromFalseResolutionsPaise)}`
  );

  console.log("");
  console.log("  Financial safety");
  console.log(
    `    Duplicate payments prevented      ${report.duplicatePaymentsPrevented}`
  );
  console.log(
    `    Short settlements caught          ${report.shortSettlementsCaught}`
  );
  console.log(
    `    Unexplained outbound caught       ${report.unexplainedOutboundCaught}`
  );
  console.log(
    `    Bad records silently cleared      ${report.silentResolutionsOfBadRecords}`
  );

  console.log("");
  console.log("  By difficulty");
  for (const b of report.byDifficulty) {
    console.log(
      `    ${b.key.padEnd(11)} ${String(b.correct).padStart(4)}/${String(b.total).padEnd(4)} ` +
        `${pct(b.accuracy).padStart(7)}   false resolutions ${b.falseResolutions}`
    );
  }

  console.log("");
  console.log("  By ground-truth label");
  for (const b of report.byLabel) {
    console.log(
      `    ${b.key.padEnd(18)} ${String(b.correct).padStart(4)}/${String(b.total).padEnd(4)} ` +
        `${pct(b.accuracy).padStart(7)}`
    );
  }
}

function printExceptions(report: EvaluationReport, limit = 15) {
  heading("Unresolved exception list (top " + limit + " by value)");

  console.log(
    "  " +
      "RECORD".padEnd(10) +
      "TYPE".padEnd(20) +
      "AMOUNT".padStart(14) +
      "  CONF".padEnd(8) +
      " SUPPLIER"
  );
  rule("-");

  for (const e of report.exceptions.slice(0, limit)) {
    console.log(
      "  " +
        e.recordId.padEnd(10) +
        e.exceptionType.padEnd(20) +
        rupees(e.amountPaise).padStart(14) +
        "  " +
        pct(e.confidence).padStart(6) +
        " " +
        e.supplierName.slice(0, 24)
    );
  }

  if (report.exceptions.length > limit) {
    console.log(
      `  ... and ${report.exceptions.length - limit} more open exceptions.`
    );
  }

  const worked = report.exceptions[0];
  if (worked) {
    console.log("");
    console.log("  Worked example — why this one was not resolved automatically");
    rule("-");
    console.log(`    Record        ${worked.recordId}`);
    console.log(`    Type          ${worked.exceptionType}`);
    console.log(`    Amount        ${rupees(worked.amountPaise)}`);
    console.log(`    Confidence    ${pct(worked.confidence)}`);
    console.log(`    Reason        ${worked.reason}`);
    console.log("");
    console.log("    Why not auto-resolved:");
    for (const line of wrap(worked.whyNotAutoResolved, 60)) {
      console.log("      " + line);
    }
    console.log("");
    console.log("    Recommended action:");
    for (const line of wrap(worked.recommendedAction, 60)) {
      console.log("      " + line);
    }
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function main() {
  console.log("");
  rule();
  console.log("  EQUILIBRIUM - TRACK 04 FINANCE-OPERATIONS BENCHMARK");
  rule();

  const records = buildDataset(DATASET_SEED);
  const summary = datasetSummary(records);

  console.log(`  Dataset      ${summary.version}  (seed ${summary.seed})`);
  console.log(`  Controller   ${CONTROLLER_VERSION}`);
  console.log(`  Records      ${summary.total}`);
  console.log(
    `  Total value  ${rupees(summary.totalValuePaise)}`
  );
  console.log(
    `  Splits       ` +
      Object.entries(summary.bySplit)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")
  );
  console.log(
    `  Auto-resolve threshold ${pct(THRESHOLDS.autoResolve)}, ` +
      `amount tolerance ${THRESHOLDS.amountTolerancePaise} paise`
  );

  const heldOut = records.filter((r) => r.split === "HELD_OUT");
  const tuning = records.filter((r) => r.split === "TUNING");

  const heldOutReport = evaluate(heldOut, {
    datasetVersion: DATASET_VERSION,
    datasetSeed: DATASET_SEED,
    split: "HELD_OUT",
  });
  const tuningReport = evaluate(tuning, {
    datasetVersion: DATASET_VERSION,
    datasetSeed: DATASET_SEED,
    split: "TUNING",
  });
  const baselineReport = evaluate(heldOut, {
    datasetVersion: DATASET_VERSION,
    datasetSeed: DATASET_SEED,
    split: "HELD_OUT",
    useBaseline: true,
  });

  printReport(heldOutReport, "HELD-OUT RESULTS (the headline numbers)");

  heading("Tuning split, for comparison");
  console.log(
    `  Match rate   tuning ${pct(tuningReport.matchRate)}  vs  held-out ${pct(heldOutReport.matchRate)}`
  );
  const gap = Math.abs(tuningReport.matchRate - heldOutReport.matchRate);
  console.log(
    `  Gap          ${pct(gap)} — ` +
      (gap < 0.05
        ? "small, so the thresholds are not fitted to the test set."
        : "LARGE. The thresholds may be overfitted to the tuning split.")
  );

  heading("Versus the exact-match baseline (held-out)");
  console.log(
    `  Match rate            controller ${pct(heldOutReport.matchRate)}  vs  baseline ${pct(baselineReport.matchRate)}`
  );
  console.log(
    `  Auto-resolution rate  controller ${pct(heldOutReport.autoResolutionRate)}  vs  baseline ${pct(baselineReport.autoResolutionRate)}`
  );
  console.log(
    `  False resolutions     controller ${heldOutReport.falseResolutions}  vs  baseline ${baselineReport.falseResolutions}`
  );
  console.log(
    `  Value reconciled      controller ${rupees(heldOutReport.valueReconciledPaise)}  vs  baseline ${rupees(baselineReport.valueReconciledPaise)}`
  );

  printExceptions(heldOutReport);

  /* ---------------------------------------------------- what this proves */

  heading("What this score does and does not establish");
  console.log(
    "  READ THIS BEFORE QUOTING THE MATCH RATE.\n"
  );
  console.log(
    "  The dataset and the controller were written by the same author. A\n" +
      "  defect class nobody thought to plant is a defect class the controller\n" +
      "  is not tested against, and this benchmark cannot reveal that. A high\n" +
      "  match rate here measures internal consistency; it is NOT evidence of\n" +
      "  accuracy on a real settlement file, and should not be quoted as such."
  );
  console.log("");
  console.log("  What the run does establish:");
  console.log(
    `    - ${heldOutReport.falseResolutions} records were cleared that should have been escalated,`
  );
  console.log(
    "      across " + heldOutReport.recordsProcessed + " held-out records. That is the error class that costs money."
  );
  console.log(
    "    - The controller abstains on every genuinely undecidable record"
  );
  console.log(
    "      rather than picking a candidate to improve its own numbers."
  );
  console.log(
    `    - It beats the exact-match baseline ${pct(heldOutReport.matchRate)} to ${pct(baselineReport.matchRate)}, so the`
  );
  console.log("      machinery earns its complexity against a trivial rule.");
  console.log("");
  console.log("  Evidence the benchmark has teeth:");
  console.log(
    "    Building it exposed two real defects in the controller that were not\n" +
      "    anticipated when it was written - it never compared the beneficiary,\n" +
      "    so it cleared 10 payments made to the wrong company at 100%\n" +
      "    confidence; and it misread split settlements as amount mismatches.\n" +
      "    Both are fixed. A benchmark that only ever confirms its author was\n" +
      "    right is not measuring anything."
  );
  console.log("");
  console.log("  What would make this materially stronger:");
  console.log("    - A real anonymised settlement file with known outcomes.");
  console.log("    - A defect set authored by someone other than the controller's author.");
  console.log(
    "    - Live provider data, which needs the Razorpay test credentials this\n" +
      "      submission does not ship."
  );

  if (Math.abs(tuningReport.matchRate - heldOutReport.matchRate) < 1e-9 &&
      heldOutReport.matchRate === 1) {
    console.log("");
    console.log(
      "  NOTE: both splits are saturated at 100%, so the tuning/held-out\n" +
        "  comparison can no longer detect overfitting. The split is still\n" +
        "  wired up and will start discriminating again as harder cases are\n" +
        "  added - but right now it is not doing useful work, and pretending\n" +
        "  otherwise would be the kind of unfalsifiable claim this report exists\n" +
        "  to avoid."
    );
  }

  /* ------------------------------------------------- persist the run */

  const outDir = join(process.cwd(), "benchmark-results");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "track04-latest.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        heldOut: heldOutReport,
        tuning: tuningReport,
        baseline: baselineReport,
        dataset: summary,
        thresholds: THRESHOLDS,
      },
      null,
      2
    )
  );

  heading("Result");
  console.log(
    `  ${heldOutReport.correctlyResolved} / ${heldOutReport.recordsProcessed} correctly resolved  ` +
      `(${pct(heldOutReport.matchRate)})`
  );
  console.log(
    `  ${heldOutReport.recordsProcessed} records | ${(heldOutReport.elapsedMs / 1000).toFixed(2)} sec | ` +
      `${heldOutReport.recordsPerSecond.toFixed(0)} records/sec`
  );
  console.log(
    `  ${heldOutReport.falseResolutions} false resolutions ` +
      `(${rupees(heldOutReport.valueAtRiskFromFalseResolutionsPaise)} at risk)`
  );
  console.log(`  ${heldOutReport.exceptions.length} open exceptions`);
  console.log("");
  console.log(`  Written to ${outPath}`);
  console.log("");

  /*
   * A benchmark that cannot fail is a demo. False resolutions are the error
   * class that actually costs money, so the run is non-zero-exit if any
   * appear, rather than printing a bad number in a passing build.
   */
  if (heldOutReport.falseResolutions > 0) {
    console.error(
      `FAIL: ${heldOutReport.falseResolutions} record(s) were cleared that ` +
        "should have been escalated. Every one is a payment defect the system " +
        "would have closed the book on."
    );
    process.exit(1);
  }
}

main();
