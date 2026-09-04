import { REASON_CODE_CATALOGUE } from "../demo/invoice-fixtures";
import { msmedPenaltyPaise } from "../benchmark/market-data";

/**
 * What an invoice anomaly actually costs, in rupees.
 *
 * "INVALID_GSTIN" tells an operator nothing about whether to care. "Rs 21,330
 * of input tax credit at risk" tells them exactly how much to care, and lets
 * the queue be sorted by money rather than by severity label.
 *
 * Every figure below is derived from a real rule:
 *   - Input tax credit is lost outright if the supplier GSTIN is invalid, so
 *     the exposure is the full tax component.
 *   - A total that disagrees with subtotal + tax overpays by the difference.
 *   - A duplicate pays the whole invoice a second time.
 *   - Terms beyond 45 days accrue statutory interest under MSMED s.16.
 */

export interface InvoiceForCosting {
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  invoiceDate: Date;
  dueDate: Date | null;
  reasonCodes: string[];
}

export interface AnomalyCost {
  code: string;
  label: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** Rupee exposure if this defect goes through unchallenged. */
  exposurePaise: number;
  /**
   * How confident we are in the number. A duplicate payment is exactly the
   * invoice value; a value outlier might be entirely legitimate.
   */
  certainty: "EXACT" | "ESTIMATED" | "CONTINGENT";
  basis: string;
}

export interface InvoiceCostSummary {
  costs: AnomalyCost[];
  /** Sum of exposures we can state exactly. */
  exactExposurePaise: number;
  /** Sum including estimated and contingent items. */
  totalExposurePaise: number;
  /** The single largest exposure, for headline copy. */
  largest: AnomalyCost | null;
}

const STATUTORY_DAYS = 45;

/**
 * Price each defect on one invoice.
 *
 * Contingent items are counted in the total but flagged, because presenting a
 * "might be legitimate" outlier as a certain loss would inflate the savings
 * figure and destroy the credibility of every other number on the page.
 */
export function costInvoiceAnomalies(
  invoice: InvoiceForCosting
): InvoiceCostSummary {
  const costs: AnomalyCost[] = [];

  for (const code of invoice.reasonCodes) {
    const entry = REASON_CODE_CATALOGUE[code];
    if (!entry) continue;

    let exposurePaise = 0;
    let certainty: AnomalyCost["certainty"] = "ESTIMATED";
    let basis = entry.cost;

    switch (code) {
      case "TOTAL_MISMATCH": {
        // We would overpay by exactly the arithmetic difference.
        const expected = invoice.subtotalPaise + invoice.taxPaise;
        exposurePaise = Math.abs(invoice.totalPaise - expected);
        certainty = "EXACT";
        basis = `Stated total differs from subtotal plus tax by exactly this amount.`;
        break;
      }

      case "INVALID_GSTIN": {
        // Input tax credit cannot be claimed against a malformed GSTIN, so the
        // whole tax component becomes an unrecoverable cost.
        exposurePaise = invoice.taxPaise;
        certainty = "EXACT";
        basis =
          "Input tax credit cannot be claimed against an invalid GSTIN, so the full GST component is unrecoverable.";
        break;
      }

      case "SIMILAR_INVOICE": {
        // If it is a duplicate and it pays, we pay the entire invoice twice.
        exposurePaise = invoice.totalPaise;
        certainty = "CONTINGENT";
        basis =
          "If this is a duplicate and it clears, the full invoice value is paid a second time.";
        break;
      }

      case "TERMS_EXCEED_MSMED_LIMIT": {
        const termsDays = invoice.dueDate
          ? Math.round(
              (invoice.dueDate.getTime() - invoice.invoiceDate.getTime()) /
                86_400_000
            )
          : STATUTORY_DAYS;
        const daysLate = Math.max(0, termsDays - STATUTORY_DAYS);
        exposurePaise = msmedPenaltyPaise(invoice.totalPaise, daysLate);
        certainty = "ESTIMATED";
        basis = `Terms run ${termsDays} days against the 45-day statutory limit. Section 16 accrues compound interest at three times the RBI bank rate on the ${daysLate} excess days.`;
        break;
      }

      case "VALUE_OUTLIER": {
        // Only the excess over the vendor's norm is at risk, and only if the
        // invoice is actually wrong.
        exposurePaise = Math.round(invoice.totalPaise * 0.5);
        certainty = "CONTINGENT";
        basis =
          "A genuine bulk order looks identical to a misplaced decimal. Exposure is shown as half the invoice as a deliberately rough placeholder pending a human decision.";
        break;
      }

      case "FUTURE_DATED":
      case "DUE_BEFORE_INVOICE": {
        // A date defect misstates a period rather than losing cash directly.
        exposurePaise = 0;
        certainty = "CONTINGENT";
        basis =
          "No direct cash loss. Corrupts ageing buckets and any forecast built on them.";
        break;
      }

      case "ROUND_AMOUNT":
      case "NO_VENDOR_HISTORY":
      default: {
        exposurePaise = 0;
        certainty = "CONTINGENT";
        break;
      }
    }

    costs.push({
      code,
      label: entry.label,
      severity: entry.severity,
      exposurePaise,
      certainty,
      basis,
    });
  }

  const exactExposurePaise = costs
    .filter((c) => c.certainty === "EXACT")
    .reduce((sum, c) => sum + c.exposurePaise, 0);

  const totalExposurePaise = costs.reduce(
    (sum, c) => sum + c.exposurePaise,
    0
  );

  const largest =
    costs.length > 0
      ? costs.reduce((a, b) => (b.exposurePaise > a.exposurePaise ? b : a))
      : null;

  return { costs, exactExposurePaise, totalExposurePaise, largest };
}

export interface PreventedLossSummary {
  invoicesReviewed: number;
  invoicesFlagged: number;
  /** Exposure we can state to the rupee. */
  exactPreventedPaise: number;
  /** Including contingent items, which may or may not be real. */
  totalPreventedPaise: number;
  byCode: Array<{ code: string; label: string; count: number; exposurePaise: number }>;
}

/**
 * Roll up across a set of invoices, for the running savings counter.
 *
 * The exact and total figures are reported separately on purpose. Quoting one
 * blended number that mixes a certain Rs 9,000 arithmetic error with a
 * speculative Rs 11 lakh outlier would be the kind of inflated claim that gets
 * a demo dismissed.
 */
export function summarisePreventedLoss(
  invoices: InvoiceForCosting[]
): PreventedLossSummary {
  const byCode = new Map<
    string,
    { code: string; label: string; count: number; exposurePaise: number }
  >();

  let exact = 0;
  let total = 0;
  let flagged = 0;

  for (const invoice of invoices) {
    const meaningful = invoice.reasonCodes.filter(
      (c) => c !== "NO_VENDOR_HISTORY"
    );
    if (meaningful.length > 0) flagged++;

    const summary = costInvoiceAnomalies(invoice);
    exact += summary.exactExposurePaise;
    total += summary.totalExposurePaise;

    for (const cost of summary.costs) {
      if (cost.code === "NO_VENDOR_HISTORY") continue;
      const existing = byCode.get(cost.code);
      if (existing) {
        existing.count++;
        existing.exposurePaise += cost.exposurePaise;
      } else {
        byCode.set(cost.code, {
          code: cost.code,
          label: cost.label,
          count: 1,
          exposurePaise: cost.exposurePaise,
        });
      }
    }
  }

  return {
    invoicesReviewed: invoices.length,
    invoicesFlagged: flagged,
    exactPreventedPaise: exact,
    totalPreventedPaise: total,
    byCode: [...byCode.values()].sort(
      (a, b) => b.exposurePaise - a.exposurePaise
    ),
  };
}
