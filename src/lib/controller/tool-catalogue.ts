import type { ControllerToolName } from "./finance-controller";

/**
 * What each controller tool is, and — critically — whether its answer is
 * computed or predicted.
 *
 * This distinction is the whole credibility question for an "AI" that touches
 * money. GST arithmetic is not a prediction: subtotal plus tax either equals
 * the total or it does not, and presenting that with the same visual weight as
 * a probabilistic risk score teaches an operator to trust both equally, which
 * is exactly wrong.
 *
 * Every tool here is READ-ONLY. The controller can observe and propose; it
 * cannot approve a payment, submit to a provider, write a ledger entry, or
 * resolve an exception. That boundary is enforced by the tool set itself
 * rather than by instructions in a prompt, because a prompt is a request and a
 * missing function is a guarantee.
 */

export type ToolNature =
  /** Arithmetic or a lookup. The answer is checkable and exact. */
  | "DETERMINISTIC"
  /** A fitted model. The answer is a probability with error attached. */
  | "MODEL"
  /** A policy rule with declared thresholds. Exact, but the thresholds are a choice. */
  | "POLICY";

export interface ToolDefinition {
  name: ControllerToolName;
  label: string;
  nature: ToolNature;
  /** What it reads. */
  reads: string;
  /** What it can never do. Stated explicitly. */
  cannot: string;
  /** How to read its output. */
  interpretation: string;
}

export const TOOL_CATALOGUE: Record<ControllerToolName, ToolDefinition> = {
  inspect_invoice_anomaly: {
    name: "inspect_invoice_anomaly",
    label: "Inspect invoice anomalies",
    nature: "DETERMINISTIC",
    reads:
      "The stored invoice, its validation reason codes, and its anomaly score.",
    cannot: "Change the invoice, clear an anomaly, or approve payment.",
    interpretation:
      "Arithmetic and structural checks. GST totals, GSTIN format, date ordering and duplicate detection are computed, not estimated — if this says the total is off by Rs 9,000, it is off by exactly Rs 9,000.",
  },
  find_supplier: {
    name: "find_supplier",
    label: "Match vendor to supplier record",
    nature: "DETERMINISTIC",
    reads: "The supplier table, scoped to this tenant.",
    cannot: "Create a supplier or alter an existing one.",
    interpretation:
      "A lookup. Either the vendor on the invoice matches a known supplier or it does not; there is no confidence involved.",
  },
  score_supplier_liquidity: {
    name: "score_supplier_liquidity",
    label: "Score liquidity risk",
    nature: "MODEL",
    reads:
      "The supplier's latest cash-flow observation, scored by the fitted logistic model.",
    cannot: "Create an offer, change policy, or move money.",
    interpretation:
      "A PROBABILITY, not a fact. Fitted on simulated cash-flow data, so it measures the model against that simulator rather than against real supplier behaviour. Treat it as an ordering of risk, not a calibrated default rate.",
  },
  check_payment_risk: {
    name: "check_payment_risk",
    label: "Check risk limits",
    nature: "POLICY",
    reads:
      "Daily exposure, per-transaction cap, per-supplier limit, and the kill switch.",
    cannot: "Raise a limit, override a block, or release the kill switch.",
    interpretation:
      "Exact given the thresholds, but the thresholds themselves are a business choice rather than a measurement. A block here is a decision the business already made, applied consistently.",
  },
};

/** Tools the controller does NOT have, and why that matters. */
export const WITHHELD_CAPABILITIES = [
  {
    capability: "Approve an offer",
    why: "Approval moves money. It requires an authenticated operator, and above the threshold, a second one.",
  },
  {
    capability: "Submit a payment to the provider",
    why: "Only the payment service does this, after approval, with an idempotency key.",
  },
  {
    capability: "Write ledger entries",
    why: "Journals are built and balanced by the accounting layer, which rejects anything unbalanced before it reaches the database.",
  },
  {
    capability: "Resolve a reconciliation exception",
    why: "Closing an exception is a judgement that must carry an operator's name and a written reason.",
  },
  {
    capability: "Change a risk limit or the kill switch",
    why: "ADMIN only, and every change is audited.",
  },
] as const;

export function toolDefinition(name: string): ToolDefinition | null {
  return TOOL_CATALOGUE[name as ControllerToolName] ?? null;
}

/** Split a run's tool calls by how much their answers can be trusted. */
export function summariseNature(toolNames: string[]): {
  deterministic: number;
  model: number;
  policy: number;
  /** True when no probabilistic step contributed to the outcome. */
  fullyDeterministic: boolean;
} {
  let deterministic = 0;
  let model = 0;
  let policy = 0;

  for (const name of toolNames) {
    const def = toolDefinition(name);
    if (!def) continue;
    if (def.nature === "DETERMINISTIC") deterministic++;
    else if (def.nature === "MODEL") model++;
    else policy++;
  }

  return { deterministic, model, policy, fullyDeterministic: model === 0 };
}
