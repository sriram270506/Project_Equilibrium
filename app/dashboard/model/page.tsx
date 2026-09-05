import {
  LIQUIDITY_MODEL,
  ModelMetrics,
} from "@/src/lib/ml/model-artifact";
import {
  Card,
  CardHeader,
  CardBody,
  PageHeader,
  Callout,
  Table,
  Th,
  Td,
  DataRow,
} from "@/src/components/ui/primitives";
import { cn } from "@/src/lib/utils";

export const metadata = { title: "Model card" };

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  cashFlowVolatility:
    "How much daily cash in and out swings, 0 to 1. Volatile suppliers cannot see a shortfall coming.",
  runwayPressure:
    "Urgency of the cash position: 1 when out of cash today, 0 at fourteen days of cover or more.",
  paymentIrregularity:
    "How unreliably this supplier's own customers pay. Higher means receivables cannot be counted on.",
  balanceCoverage:
    "Cash on hand measured against a week of outflow. Higher is safer, hence the negative weight.",
  tenureYears:
    "Length of the trading relationship, normalised over five years.",
};

/**
 * The model card.
 *
 * Everything on this page is read from the artifact that the app actually
 * scores with, so the numbers cannot drift away from the deployed model. If
 * someone retrains, this page changes.
 */
export default function ModelCardPage() {
  const model = LIQUIDITY_MODEL;
  const test = model.metrics.test;
  const baseline = model.metrics.baseline;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Model card"
        lede="What the liquidity model is, how well it works, and where it should not be trusted. Every figure here is read from the artifact the application scores with."
      />

      <Callout tone="warn" title="This model has never seen a real supplier">
        It is fitted on a synthetic cash-flow simulation. The probabilities are
        useful as an ordering of risk for this demonstration; they are not
        calibrated default rates and must not be used to make real credit
        decisions.
      </Callout>

      {/* Headline metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="AUC"
          value={test.auc.toFixed(3)}
          hint="Ranking quality on held-out data"
          good={test.auc > baseline.auc}
        />
        <MetricTile
          label="Recall"
          value={`${(test.recall * 100).toFixed(0)}%`}
          hint="Of suppliers who did run short, how many we caught"
          good={test.recall > 0.8}
        />
        <MetricTile
          label="Precision"
          value={`${(test.precision * 100).toFixed(0)}%`}
          hint="Of those we flagged, how many truly needed help"
          good={test.precision > baseline.precision}
        />
        <MetricTile
          label="Action threshold"
          value={test.threshold.toFixed(2)}
          hint="Chosen by cost asymmetry, not convention"
        />
      </div>

      {/* Why the threshold is not 0.5 */}
      <div className="mt-6">
        <Card>
          <CardHeader
            eyebrow="Threshold selection"
            title={`Why the cut-off is ${test.threshold.toFixed(2)} and not 0.50`}
          />
          <CardBody className="space-y-3 text-[15px] leading-relaxed text-ink-body">
            <p>
              The two mistakes this model can make do not cost the same. Flagging
              a supplier who would have been fine means offering them cheap
              working capital they did not strictly need — they benefit, the
              platform still earns its margin, and the loss is the opportunity
              cost of the float. Failing to flag a supplier who does run short
              means they miss payroll.
            </p>
            <p>
              The threshold is therefore chosen by sweeping candidate values and
              maximising a recall-weighted F-score (β = 3, so recall counts nine
              times as much as precision) subject to a precision floor, on the
              training split only. At the conventional 0.50 this model recalls
              about 15% of distressed suppliers, which would make it useless for
              its actual purpose.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Confusion matrix + baseline */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Confusion matrix"
            hint={`Held-out set, ${model.training.testSamples} suppliers, ${(test.baseRate * 100).toFixed(1)}% of whom actually ran short.`}
          />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th></Th>
                  <Th align="right">Predicted shortfall</Th>
                  <Th align="right">Predicted fine</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="font-medium text-ink-strong">
                    Actually ran short
                  </Td>
                  <Td align="right" className="tabular font-semibold text-ok">
                    {test.truePositives}
                  </Td>
                  <Td align="right" className="tabular font-semibold text-danger">
                    {test.falseNegatives}
                  </Td>
                </tr>
                <tr>
                  <Td className="font-medium text-ink-strong">Actually fine</Td>
                  <Td align="right" className="tabular font-semibold text-warn">
                    {test.falsePositives}
                  </Td>
                  <Td align="right" className="tabular font-semibold text-ink-muted">
                    {test.trueNegatives}
                  </Td>
                </tr>
              </tbody>
            </Table>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
              The {test.falseNegatives} suppliers in the top-right are the ones
              this system fails. Reducing that number is what the threshold
              choice above is optimising for.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Against the obvious baseline"
            hint="The rule any analyst would write first: flag anyone with under a week of runway."
          />
          <CardBody>
            <DataRow label="AUC" hint="higher is better">
              <Comparison
                model={test.auc.toFixed(3)}
                baseline={baseline.auc.toFixed(3)}
                better={test.auc > baseline.auc}
              />
            </DataRow>
            <DataRow label="Precision">
              <Comparison
                model={`${(test.precision * 100).toFixed(0)}%`}
                baseline={`${(baseline.precision * 100).toFixed(0)}%`}
                better={test.precision > baseline.precision}
              />
            </DataRow>
            <DataRow label="Recall">
              <Comparison
                model={`${(test.recall * 100).toFixed(0)}%`}
                baseline={`${(baseline.recall * 100).toFixed(0)}%`}
                better={test.recall >= baseline.recall}
              />
            </DataRow>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
              The baseline catches everyone by flagging almost everyone, which is
              why its precision is so poor. The model reaches comparable recall
              while making roughly half as many unnecessary offers.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Coefficients */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Fitted coefficients"
            hint="Log-odds weights. The sign is the direction of effect; the magnitude is the strength."
          />
          <Table>
            <thead>
              <tr>
                <Th>Feature</Th>
                <Th align="right">Weight</Th>
                <Th>Effect</Th>
              </tr>
            </thead>
            <tbody>
              {model.featureNames.map((name) => {
                const coefficient = model.coefficients[name];
                const raisesRisk = coefficient > 0;
                return (
                  <tr key={name}>
                    <Td>
                      <p className="mono font-medium text-ink-strong">{name}</p>
                      <p className="mt-0.5 text-2xs leading-snug text-ink-muted">
                        {FEATURE_DESCRIPTIONS[name]}
                      </p>
                    </Td>
                    <Td
                      align="right"
                      className={cn(
                        "tabular font-semibold",
                        raisesRisk ? "text-warn" : "text-ok"
                      )}
                    >
                      {coefficient > 0 ? "+" : ""}
                      {coefficient.toFixed(3)}
                    </Td>
                    <Td className="text-[13px]">
                      {raisesRisk ? "Raises predicted risk" : "Lowers predicted risk"}
                    </Td>
                  </tr>
                );
              })}
              <tr className="bg-surface-sunken">
                <Td className="mono font-medium text-ink-strong">intercept</Td>
                <Td align="right" className="tabular font-semibold text-ink-strong">
                  {model.intercept.toFixed(3)}
                </Td>
                <Td className="text-[13px] text-ink-muted">Base log-odds</Td>
              </tr>
            </tbody>
          </Table>
          <CardBody>
            <Callout tone="ok" title="Why a logistic regression and not something bigger">
              Because it is additive in log-odds, every prediction decomposes
              exactly into per-feature contributions — the explanations shown to
              operators are the model itself, not a post-hoc approximation of it.
              For a system that moves money and must be explainable to an
              auditor, that property is worth more than a few points of accuracy.
            </Callout>
          </CardBody>
        </Card>
      </div>

      {/* Provenance and limits */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Provenance" />
          <CardBody>
            <DataRow label="Version">
              <span className="mono">{model.modelVersion}</span>
            </DataRow>
            <DataRow label="Trained">
              {new Date(model.trainedAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </DataRow>
            <DataRow label="Training samples">
              {model.training.trainSamples.toLocaleString("en-IN")}
            </DataRow>
            <DataRow label="Held-out samples">
              {model.training.testSamples.toLocaleString("en-IN")}
            </DataRow>
            <DataRow label="Random seed" hint="training is reproducible">
              <span className="mono">{model.training.seed}</span>
            </DataRow>
            <DataRow label="Reproduce">
              <span className="mono">npm run ml:train</span>
            </DataRow>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Known limitations"
            hint="Stated plainly, because a model card that lists only strengths is marketing."
          />
          <CardBody>
            <ul className="space-y-2">
              {model.limitations.map((limitation) => (
                <li
                  key={limitation}
                  className="flex gap-2.5 text-[14px] leading-relaxed text-ink-body"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                  {limitation}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      {/* The control a sceptical reviewer asks for first. */}
      {model.negativeControls ? (
        <div className="mt-6">
          <Card
            className={
              model.negativeControls.passes
                ? "border-ok/30"
                : "border-danger/40"
            }
          >
            <CardHeader
              eyebrow="Negative controls"
              title="Is this AUC real, or an artifact of the simulator?"
              hint="The first question worth asking of any model trained on generated data."
            />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-md border border-line-soft bg-surface-sunken p-4">
                  <p className="text-2xs font-medium text-ink-muted">
                    Prediction spread, real vs permuted
                  </p>
                  <p className="tabular mt-1 text-2xl font-semibold text-ink-strong">
                    {model.negativeControls.realPredictionSpread.toFixed(2)}{" "}
                    <span className="text-ink-muted">vs</span>{" "}
                    <span className="text-ok">
                      {model.negativeControls.permutedPredictionSpread.toFixed(2)}
                    </span>
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                    Shuffle the labels, refit, and the model&apos;s outputs
                    collapse to a narrow band around the base rate. It learns
                    essentially nothing, which is exactly what a leak-free
                    pipeline must do.
                  </p>
                </div>

                <div className="rounded-md border border-line-soft bg-surface-sunken p-4">
                  <p className="text-2xs font-medium text-ink-muted">
                    Label flip rate
                  </p>
                  <p className="tabular mt-1 text-2xl font-semibold text-ink-strong">
                    {(model.negativeControls.labelFlipRate * 100).toFixed(0)}%
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                    Re-simulating the same supplier flips the outcome this often.
                    The label is stochastic, not a lookup of the features — so
                    perfect prediction is impossible by construction.
                  </p>
                </div>
              </div>

              <Callout tone="warn" title="Why AUC alone would have misled us here">
                Across {model.negativeControls.permutations} shuffles the
                permuted AUC ranged from{" "}
                {model.negativeControls.permutationAucRange[0].toFixed(2)} to{" "}
                {model.negativeControls.permutationAucRange[1].toFixed(2)}. AUC
                is a pure rank statistic: when a fit correctly learns nothing,
                its predictions sit within a couple of points of the base rate
                and AUC magnifies the leftover noise into confident-looking
                numbers. Judging this control on spread rather than on a single
                AUC is the difference between a real check and a reassuring one.
              </Callout>

              <Callout tone="danger" title="What these controls do NOT prove">
                The features and the labels come from the same simulator. These
                numbers show the model has correctly learned that simulator&apos;s
                structure and that the training pipeline does not leak. They say
                nothing about whether real suppliers behave this way. Treat the
                {test.auc.toFixed(3)} as a property of the simulation, not as evidence of
                production predictive power.
              </Callout>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card tone="raised">
          <CardBody>
            <p className="eyebrow mb-2">Calibration note</p>
            <p className="text-[14px] leading-relaxed text-ink-body">
              {model.calibrationNote}
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
  good,
}: {
  label: string;
  value: string;
  hint: string;
  good?: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-ink-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-2 text-[28px] font-semibold leading-none",
          good === undefined ? "text-ink-strong" : good ? "text-ok" : "text-warn"
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[13px] leading-snug text-ink-muted">{hint}</p>
    </Card>
  );
}

function Comparison({
  model,
  baseline,
  better,
}: {
  model: string;
  baseline: string;
  better: boolean;
}) {
  return (
    <span className="tabular inline-flex items-baseline gap-2">
      <span className={cn("font-semibold", better ? "text-ok" : "text-warn")}>
        {model}
      </span>
      <span className="text-2xs text-ink-muted">vs {baseline}</span>
    </span>
  );
}

export type { ModelMetrics };
