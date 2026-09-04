import { prisma } from "../prisma";

/**
 * Vendor invoicing history, and outlier detection derived from it.
 *
 * The previous outlier check asserted that an invoice was "far above this
 * vendor's normal" without ever computing what normal was — there was no
 * history query behind it. A reviewer checking that claim would find nothing,
 * which is worse than not making the claim.
 *
 * This computes the baseline from the vendor's actual prior invoices and
 * reports how it was derived, including refusing to judge when there is not
 * enough history to judge from.
 */

export interface VendorBaseline {
  vendorGstin: string;
  vendorName: string;
  /** Prior invoices used to build the baseline. */
  sampleSize: number;
  medianPaise: number;
  meanPaise: number;
  /** Median absolute deviation - robust to the outliers we are looking for. */
  madPaise: number;
  maxPaise: number;
  minPaise: number;
  /** False when there is too little history to say anything. */
  sufficient: boolean;
}

/** Below this, any "normal" we computed would be noise. */
export const MIN_HISTORY_FOR_BASELINE = 3;

/** Modified z-score above this counts as an outlier. */
export const OUTLIER_MODIFIED_Z = 3.5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Build a baseline from a vendor's prior invoices.
 *
 * Median and MAD rather than mean and standard deviation, because the mean and
 * SD are both dragged upward by the very outlier we are trying to detect — one
 * huge invoice can inflate the SD enough that it no longer looks unusual.
 */
export function computeBaseline(
  vendorGstin: string,
  vendorName: string,
  priorTotalsPaise: number[]
): VendorBaseline {
  const med = median(priorTotalsPaise);
  const deviations = priorTotalsPaise.map((v) => Math.abs(v - med));

  return {
    vendorGstin,
    vendorName,
    sampleSize: priorTotalsPaise.length,
    medianPaise: med,
    meanPaise:
      priorTotalsPaise.length > 0
        ? Math.round(
            priorTotalsPaise.reduce((a, b) => a + b, 0) / priorTotalsPaise.length
          )
        : 0,
    madPaise: median(deviations),
    maxPaise: priorTotalsPaise.length ? Math.max(...priorTotalsPaise) : 0,
    minPaise: priorTotalsPaise.length ? Math.min(...priorTotalsPaise) : 0,
    sufficient: priorTotalsPaise.length >= MIN_HISTORY_FOR_BASELINE,
  };
}

export interface OutlierVerdict {
  isOutlier: boolean;
  /** Null when there is not enough history to compute one. */
  modifiedZScore: number | null;
  /** How many times the vendor's median this invoice is. */
  multipleOfMedian: number | null;
  baseline: VendorBaseline;
  /** What was actually computed, so the claim can be checked. */
  explanation: string;
}

/**
 * Decide whether an invoice is unusual FOR THIS VENDOR.
 *
 * Returns `isOutlier: false` with an explicit explanation when history is too
 * thin, rather than guessing. "We cannot tell yet" is a legitimate and useful
 * answer; a fabricated one is not.
 */
export function assessOutlier(
  totalPaise: number,
  baseline: VendorBaseline
): OutlierVerdict {
  if (!baseline.sufficient) {
    return {
      isOutlier: false,
      modifiedZScore: null,
      multipleOfMedian: null,
      baseline,
      explanation: `Only ${baseline.sampleSize} prior invoice${baseline.sampleSize === 1 ? "" : "s"} from this vendor. At least ${MIN_HISTORY_FOR_BASELINE} are needed before "normal" means anything, so no outlier judgement is made.`,
    };
  }

  const multipleOfMedian =
    baseline.medianPaise > 0
      ? Math.round((totalPaise / baseline.medianPaise) * 10) / 10
      : null;

  // A MAD of zero means every prior invoice was identical; fall back to a
  // proportional test rather than dividing by zero.
  if (baseline.madPaise === 0) {
    const isOutlier = totalPaise > baseline.medianPaise * 2;
    return {
      isOutlier,
      modifiedZScore: null,
      multipleOfMedian,
      baseline,
      explanation: isOutlier
        ? `Every prior invoice from this vendor was exactly ${(baseline.medianPaise / 100).toLocaleString("en-IN")}. This one is ${multipleOfMedian}x that.`
        : `Consistent with this vendor's ${baseline.sampleSize} prior invoices, which were all the same amount.`,
    };
  }

  // Modified z-score. 0.6745 is the constant that makes MAD a consistent
  // estimator of the standard deviation for normally distributed data.
  const modifiedZScore =
    Math.round(
      ((0.6745 * (totalPaise - baseline.medianPaise)) / baseline.madPaise) * 100
    ) / 100;

  const isOutlier = Math.abs(modifiedZScore) > OUTLIER_MODIFIED_Z;

  return {
    isOutlier,
    modifiedZScore,
    multipleOfMedian,
    baseline,
    explanation: isOutlier
      ? `This vendor's ${baseline.sampleSize} prior invoices have a median of Rs ${(baseline.medianPaise / 100).toLocaleString("en-IN")}. At Rs ${(totalPaise / 100).toLocaleString("en-IN")} this is ${multipleOfMedian}x the median, a modified z-score of ${modifiedZScore} against a threshold of ${OUTLIER_MODIFIED_Z}.`
      : `Within the normal range for this vendor: ${multipleOfMedian}x the median across ${baseline.sampleSize} prior invoices, modified z-score ${modifiedZScore}.`,
  };
}

/**
 * Fetch a vendor's history from the database and assess one invoice against it.
 * Scoped by tenant, so one marketplace's vendor history never informs another's.
 */
export async function assessInvoiceAgainstHistory(
  tenantId: string,
  vendorGstin: string,
  vendorName: string,
  totalPaise: number,
  excludeInvoiceId?: string
): Promise<OutlierVerdict> {
  const priors = await prisma.invoice.findMany({
    where: {
      tenantId,
      vendorGstin,
      ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
    },
    select: { totalPaise: true },
    orderBy: { invoiceDate: "desc" },
    take: 50,
  });

  const baseline = computeBaseline(
    vendorGstin,
    vendorName,
    priors.map((p) => p.totalPaise)
  );

  return assessOutlier(totalPaise, baseline);
}
