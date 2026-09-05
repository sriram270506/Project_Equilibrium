import { describe, it, expect } from "vitest";
import {
  buildAdversarialSet,
  attackCatalogue,
  robustnessLadder,
  ADVERSARIAL_SEED,
} from "./adversarial";
import { buildDataset, DATASET_SEED } from "./dataset";
import { evaluate } from "./evaluate";
import { processRecord } from "./controller";

/**
 * The adversarial set exists to fail. These tests pin the ONE thing that must
 * not happen when it does — the controller must not clear a record that needs
 * a human — while deliberately leaving room for it to score badly.
 *
 * A test asserting a high match rate here would defeat the purpose: it would
 * turn the adversarial set into another thing to tune against, which is
 * exactly the trap the main benchmark already documents.
 */

const adversarial = buildAdversarialSet(ADVERSARIAL_SEED);

describe("the adversarial set", () => {
  it("is deterministic", () => {
    expect(JSON.stringify(buildAdversarialSet(ADVERSARIAL_SEED))).toBe(
      JSON.stringify(adversarial)
    );
  });

  it("states, for every case, which assumption it attacks", () => {
    for (const record of adversarial) {
      expect(record.attack.assumption.length).toBeGreaterThan(40);
      expect(record.attack.attack.length).toBeGreaterThan(40);
    }
    expect(attackCatalogue().length).toBeGreaterThanOrEqual(8);
  });

  it("never lets the controller pay the wrong company", () => {
    /*
     * The check that earned its place. Before the counterparty comparison was
     * made conservative, this set cleared twelve payments to separately
     * registered companies whose names differed only by a corporate suffix -
     * at full confidence, because the normaliser had thrown that suffix away.
     */
    const cleared = adversarial
      .map((record) => ({ record, decision: processRecord(record) }))
      .filter(
        ({ record, decision }) =>
          record.groundTruth.expectedAction === "ESCALATE" &&
          decision.outcome === "AUTO_RESOLVED"
      );

    expect(
      cleared.map((c) => `${c.record.recordId} (${c.record.groundTruth.label})`)
    ).toEqual([]);
  });

  it("is genuinely harder than the main benchmark", () => {
    // If it ever matches the main benchmark, it has stopped attacking anything
    // and needs new cases rather than a victory lap.
    const advReport = evaluate(adversarial, {
      datasetVersion: "adversarial",
      datasetSeed: ADVERSARIAL_SEED,
      split: "HELD_OUT",
    });

    const main = evaluate(
      buildDataset(DATASET_SEED).filter((r) => r.split === "HELD_OUT"),
      { datasetVersion: "main", datasetSeed: DATASET_SEED, split: "HELD_OUT" }
    );

    expect(advReport.matchRate).toBeLessThan(main.matchRate);
  });

  it("fails only by over-escalating, never by getting it wrong", () => {
    const report = evaluate(adversarial, {
      datasetVersion: "adversarial",
      datasetSeed: ADVERSARIAL_SEED,
      split: "HELD_OUT",
    });

    expect(report.falseResolutions).toBe(0);
    expect(report.valueAtRiskFromFalseResolutionsPaise).toBe(0);
    // And it does still fail, or the set is not doing its job.
    expect(report.missedMatches).toBeGreaterThan(0);
  });
});

describe("the robustness ladder", () => {
  const base = buildDataset(DATASET_SEED).filter((r) => r.split === "HELD_OUT");
  const rungs = robustnessLadder(base);

  it("starts from the unmodified dataset", () => {
    expect(rungs[0].label).toBe("baseline");
    expect(rungs[0].records).toHaveLength(base.length);
  });

  it("leaves the ground truth untouched at every rung", () => {
    /*
     * Every perturbation is presentational, so a correct system's answers
     * should not move. If a rung changed an expected action, the ladder would
     * be measuring a different question at each step and the comparison would
     * be meaningless.
     */
    for (const rung of rungs) {
      for (let i = 0; i < base.length; i++) {
        expect(rung.records[i].groundTruth.expectedAction).toBe(
          base[i].groundTruth.expectedAction
        );
        expect(rung.records[i].groundTruth.label).toBe(
          base[i].groundTruth.label
        );
      }
    }
  });

  it("degrades the match rate monotonically enough to be informative", () => {
    const rates = rungs.map(
      (rung) =>
        evaluate(rung.records, {
          datasetVersion: "perturbed",
          datasetSeed: DATASET_SEED,
          split: "HELD_OUT",
        }).matchRate
    );

    expect(rates[0]).toBeGreaterThan(rates[rates.length - 1]);
  });

  it("holds false resolutions at zero however bad the data gets", () => {
    /*
     * The headline property. The match rate is allowed to fall - and does,
     * from 100% to roughly 67% - but every point of that fall must be the
     * controller asking for a human more often, not getting things wrong more
     * often. A finance system may degrade into caution; it may not degrade
     * into error.
     */
    for (const rung of rungs) {
      const report = evaluate(rung.records, {
        datasetVersion: "perturbed",
        datasetSeed: DATASET_SEED,
        split: "HELD_OUT",
      });
      expect(
        `${rung.label}: ${report.falseResolutions} false resolutions`
      ).toBe(`${rung.label}: 0 false resolutions`);
    }
  });
});
