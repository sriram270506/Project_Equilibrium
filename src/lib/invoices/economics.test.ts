import { describe, it, expect } from "vitest";
import { costInvoiceAnomalies, summarisePreventedLoss } from "./economics";
import {
  computeBaseline,
  assessOutlier,
  MIN_HISTORY_FOR_BASELINE,
} from "./vendor-history";

const base = {
  subtotalPaise: 8_60_000_00,
  taxPaise: 1_54_800_00,
  totalPaise: 10_14_800_00,
  invoiceDate: new Date("2026-08-01T00:00:00Z"),
  dueDate: new Date("2026-09-15T00:00:00Z"), // 45 days, compliant
};

describe("Costing invoice anomalies in rupees", () => {
  it("prices an arithmetic mismatch at exactly the difference", () => {
    const summary = costInvoiceAnomalies({
      ...base,
      totalPaise: 10_23_800_00, // Rs 9,000 more than subtotal + tax
      reasonCodes: ["TOTAL_MISMATCH"],
    });
    expect(summary.costs[0].exposurePaise).toBe(9_000_00);
    expect(summary.costs[0].certainty).toBe("EXACT");
    expect(summary.exactExposurePaise).toBe(9_000_00);
  });

  it("prices an invalid GSTIN at the full tax component", () => {
    const summary = costInvoiceAnomalies({
      ...base,
      reasonCodes: ["INVALID_GSTIN"],
    });
    // Input tax credit is lost entirely, so the exposure is all the GST.
    expect(summary.costs[0].exposurePaise).toBe(base.taxPaise);
    expect(summary.costs[0].certainty).toBe("EXACT");
  });

  it("prices a duplicate at the whole invoice, but marks it contingent", () => {
    const summary = costInvoiceAnomalies({
      ...base,
      reasonCodes: ["SIMILAR_INVOICE"],
    });
    expect(summary.costs[0].exposurePaise).toBe(base.totalPaise);
    // It may not actually be a duplicate, so it must not inflate the exact figure.
    expect(summary.costs[0].certainty).toBe("CONTINGENT");
    expect(summary.exactExposurePaise).toBe(0);
  });

  it("prices an MSMED breach from the days beyond the statutory limit", () => {
    const compliant = costInvoiceAnomalies({
      ...base,
      reasonCodes: ["TERMS_EXCEED_MSMED_LIMIT"],
    });
    const breaching = costInvoiceAnomalies({
      ...base,
      dueDate: new Date("2026-10-30T00:00:00Z"), // 90 days
      reasonCodes: ["TERMS_EXCEED_MSMED_LIMIT"],
    });
    expect(breaching.costs[0].exposurePaise).toBeGreaterThan(
      compliant.costs[0].exposurePaise
    );
    expect(breaching.costs[0].basis).toContain("45-day statutory limit");
  });

  it("assigns no cash cost to a date defect", () => {
    const summary = costInvoiceAnomalies({
      ...base,
      reasonCodes: ["FUTURE_DATED"],
    });
    expect(summary.costs[0].exposurePaise).toBe(0);
    expect(summary.costs[0].basis).toContain("No direct cash loss");
  });

  it("accumulates when one invoice carries several faults", () => {
    const summary = costInvoiceAnomalies({
      ...base,
      totalPaise: 10_23_800_00,
      dueDate: new Date("2026-10-15T00:00:00Z"),
      reasonCodes: ["TOTAL_MISMATCH", "TERMS_EXCEED_MSMED_LIMIT"],
    });
    expect(summary.costs).toHaveLength(2);
    expect(summary.totalExposurePaise).toBeGreaterThan(
      summary.exactExposurePaise
    );
  });
});

describe("Prevented-loss rollup", () => {
  const invoices = [
    { ...base, reasonCodes: ["NO_VENDOR_HISTORY"] },
    { ...base, totalPaise: 10_23_800_00, reasonCodes: ["TOTAL_MISMATCH"] },
    { ...base, reasonCodes: ["INVALID_GSTIN"] },
    { ...base, reasonCodes: ["SIMILAR_INVOICE"] },
  ];

  it("counts only genuinely flagged invoices", () => {
    const s = summarisePreventedLoss(invoices);
    expect(s.invoicesReviewed).toBe(4);
    // NO_VENDOR_HISTORY is not a defect, so that invoice is not "flagged".
    expect(s.invoicesFlagged).toBe(3);
  });

  it("keeps exact and speculative exposure separate", () => {
    const s = summarisePreventedLoss(invoices);
    // Exact = Rs 9,000 mismatch + Rs 1,54,800 lost ITC.
    expect(s.exactPreventedPaise).toBe(9_000_00 + 1_54_800_00);
    // Total additionally includes the contingent duplicate.
    expect(s.totalPreventedPaise).toBeGreaterThan(s.exactPreventedPaise);
  });

  it("ranks reason codes by exposure", () => {
    const s = summarisePreventedLoss(invoices);
    for (let i = 1; i < s.byCode.length; i++) {
      expect(s.byCode[i - 1].exposurePaise).toBeGreaterThanOrEqual(
        s.byCode[i].exposurePaise
      );
    }
    expect(s.byCode.some((c) => c.code === "NO_VENDOR_HISTORY")).toBe(false);
  });
});

describe("Vendor baseline and outlier detection", () => {
  it("refuses to judge without enough history", () => {
    const baseline = computeBaseline("27AABCA1234K1Z5", "Acme", [40_000_00]);
    const verdict = assessOutlier(11_50_000_00, baseline);

    expect(baseline.sufficient).toBe(false);
    expect(verdict.isOutlier).toBe(false);
    expect(verdict.modifiedZScore).toBeNull();
    // The explanation must say why it declined to judge, naming the threshold.
    expect(verdict.explanation).toContain(String(MIN_HISTORY_FOR_BASELINE));
    expect(verdict.explanation).toMatch(/no outlier judgement is made/i);
  });

  it("flags a genuine outlier once history exists", () => {
    const priors = [38_000_00, 41_000_00, 39_500_00, 42_000_00, 40_500_00];
    const baseline = computeBaseline("27AABCA1234K1Z5", "Acme", priors);
    const verdict = assessOutlier(11_50_000_00, baseline);

    expect(baseline.sufficient).toBe(true);
    expect(verdict.isOutlier).toBe(true);
    expect(verdict.multipleOfMedian).toBeGreaterThan(20);
    // The explanation must state what it computed, so the claim is checkable.
    expect(verdict.explanation).toContain("median");
    expect(verdict.explanation).toContain("z-score");
  });

  it("does not flag an invoice within the vendor's normal range", () => {
    const priors = [38_000_00, 41_000_00, 39_500_00, 42_000_00, 40_500_00];
    const baseline = computeBaseline("27AABCA1234K1Z5", "Acme", priors);
    const verdict = assessOutlier(43_000_00, baseline);
    expect(verdict.isOutlier).toBe(false);
  });

  it("uses the median, so one huge prior cannot mask the next one", () => {
    // A mean-and-SD approach would be dragged up by the 50 lakh invoice and
    // stop flagging anything afterwards. The median barely moves.
    const priors = [40_000_00, 41_000_00, 39_000_00, 50_00_000_00];
    const baseline = computeBaseline("27AABCA1234K1Z5", "Acme", priors);
    expect(baseline.medianPaise).toBeLessThan(1_00_000_00);
    expect(baseline.meanPaise).toBeGreaterThan(10_00_000_00);
    expect(assessOutlier(11_50_000_00, baseline).isOutlier).toBe(true);
  });

  it("handles a vendor whose invoices are all identical", () => {
    const priors = [50_000_00, 50_000_00, 50_000_00, 50_000_00];
    const baseline = computeBaseline("27AABCA1234K1Z5", "Acme", priors);
    expect(baseline.madPaise).toBe(0);
    expect(assessOutlier(50_000_00, baseline).isOutlier).toBe(false);
    expect(assessOutlier(5_00_000_00, baseline).isOutlier).toBe(true);
  });
});
