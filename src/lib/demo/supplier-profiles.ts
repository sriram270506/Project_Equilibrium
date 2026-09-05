import {
  ASSUMPTIONS,
  PAYMENT_BEHAVIOUR,
} from "../benchmark/population-calibration";

/**
 * The cast of the demo.
 *
 * Twelve suppliers with deliberately different cash-flow shapes, so that
 * scoring them produces a real spread rather than a uniform result. Three come
 * back RECOMMENDED and nine are rejected by policy, which is roughly the mix a
 * marketplace actually sees and lets the walkthrough show policy refusing
 * offers as well as approving them.
 *
 * This header said "six" while the array held twelve. The count is asserted in
 * the demo verifier now, so the two cannot drift apart again.
 *
 * Shared by the Prisma seed and the demo reset endpoint so the two can never
 * drift apart.
 */

export interface SupplierProfile {
  name: string;
  email: string;
  riskTier: "LOW" | "MEDIUM" | "HIGH";
  /** One line of human context for the UI. */
  story: string;
  /**
   * Cash-flow shape used to generate observations.
   *
   * Sized to the calibrated population in
   * src/lib/benchmark/population-calibration.ts: each figure below is
   * `annualTurnover x outflowShare / 365`, placing these twelve firms between
   * roughly Rs 8 lakh and Rs 19 lakh of annual turnover. That band is chosen
   * so a supplier here looks like one drawn from the same distribution the
   * model was trained on. An earlier version used figures around Rs 400/day of
   * outflow — implying Rs 1.5 lakh of annual turnover — which is smaller than
   * any firm that would hold a financeable invoice, and made the demo
   * population incoherent with the training population.
   */
  shape: {
    /** Typical daily outflow in paise. */
    dailyOutflowPaise: number;
    /** Days of cash cover at the end of the window. */
    endingRunwayDays: number;
    /** Fraction of customer payments that arrive on time, 0-1. */
    paymentRegularity: number;
    /** Relative swing in daily cash flow, 0-1. */
    volatility: number;
    /** Whether runway is trending down over the window. */
    deteriorating: boolean;
  };
}

export const SUPPLIER_PROFILES: SupplierProfile[] = [
  {
    name: "Aarav Industrial Components",
    email: "finance@aarav.in",
    riskTier: "LOW",
    story:
      "Machine parts for two large OEMs in Pune. Reliable revenue, but both customers pay on 45-day terms and payroll is weekly.",
    shape: {
      dailyOutflowPaise: 296000,
      endingRunwayDays: 2.4,
      paymentRegularity: 0.55,
      volatility: 0.31,
      deteriorating: true,
    },
  },
  {
    name: "Kaveri Logistics Parts",
    email: "billing@kaveri.in",
    riskTier: "HIGH",
    story:
      "Truck spares distributor in Coimbatore. Thin margins, lumpy demand, and customers who pay late as a matter of habit.",
    shape: {
      dailyOutflowPaise: 268000,
      endingRunwayDays: 1.8,
      paymentRegularity: 0.42,
      volatility: 0.44,
      deteriorating: true,
    },
  },
  {
    name: "Vindhya Textile Mills",
    email: "accounts@vindhya.in",
    riskTier: "HIGH",
    story:
      "Cotton fabric supplier in Surat. A single anchor buyer stretched terms from 30 to 60 days last quarter.",
    shape: {
      dailyOutflowPaise: 438000,
      endingRunwayDays: 3.1,
      paymentRegularity: 0.48,
      volatility: 0.38,
      deteriorating: true,
    },
  },
  {
    name: "Nila Packaging Works",
    email: "admin@nila.in",
    riskTier: "MEDIUM",
    story:
      "Corrugated packaging in Chennai. Seasonal, currently between two large orders - borderline rather than distressed.",
    shape: {
      dailyOutflowPaise: 226000,
      endingRunwayDays: 6.5,
      paymentRegularity: 0.71,
      volatility: 0.26,
      deteriorating: true,
    },
  },
  {
    name: "Bhavani Agro Processing",
    email: "finance@bhavani.in",
    riskTier: "MEDIUM",
    story:
      "Spice grading and packing in Guntur. Harvest-cycle cash flows mean predictable troughs.",
    shape: {
      dailyOutflowPaise: 293000,
      endingRunwayDays: 5.2,
      paymentRegularity: 0.66,
      volatility: 0.35,
      deteriorating: true,
    },
  },
  {
    name: "Girnar Auto Fasteners",
    email: "ops@girnar.in",
    riskTier: "MEDIUM",
    story:
      "Nuts and bolts for the Rajkot auto cluster. Steady orders, but one buyer disputes invoices routinely.",
    shape: {
      dailyOutflowPaise: 240000,
      endingRunwayDays: 8.4,
      paymentRegularity: 0.63,
      volatility: 0.29,
      deteriorating: false,
    },
  },
  {
    name: "Saffron Retail Supply",
    email: "ops@saffron.in",
    riskTier: "MEDIUM",
    story:
      "FMCG distributor in Jaipur with a broad retail base. Many small customers paying quickly smooths the cash curve.",
    shape: {
      dailyOutflowPaise: 299000,
      endingRunwayDays: 16,
      paymentRegularity: 0.88,
      volatility: 0.14,
      deteriorating: false,
    },
  },
  {
    name: "Konkan Marine Exports",
    email: "finance@konkan.in",
    riskTier: "HIGH",
    story:
      "Seafood exporter in Ratnagiri. Letter-of-credit cycles make receipts chunky and hard to time.",
    shape: {
      dailyOutflowPaise: 473000,
      endingRunwayDays: 9.5,
      paymentRegularity: 0.58,
      volatility: 0.52,
      deteriorating: false,
    },
  },
  {
    name: "Orbit Kitchenware",
    email: "finance@orbit.in",
    riskTier: "MEDIUM",
    story:
      "Kitchen equipment for restaurants in Hyderabad. Steady repeat orders and disciplined collections.",
    shape: {
      dailyOutflowPaise: 253000,
      endingRunwayDays: 13,
      paymentRegularity: 0.85,
      volatility: 0.17,
      deteriorating: false,
    },
  },
  {
    name: "Deccan Print Solutions",
    email: "billing@deccanprint.in",
    riskTier: "LOW",
    story:
      "Commercial printing in Bengaluru. Advance deposits on large jobs keep the balance healthy.",
    shape: {
      dailyOutflowPaise: 205000,
      endingRunwayDays: 19,
      paymentRegularity: 0.91,
      volatility: 0.12,
      deteriorating: false,
    },
  },
  {
    name: "Meridian Home Goods",
    email: "finance@meridian.in",
    riskTier: "LOW",
    story:
      "Established homeware brand in Noida. Holds a working-capital buffer by policy and collects promptly.",
    shape: {
      dailyOutflowPaise: 365000,
      endingRunwayDays: 22,
      paymentRegularity: 0.93,
      volatility: 0.09,
      deteriorating: false,
    },
  },
  {
    name: "Sundaram Electricals",
    email: "accounts@sundaram.in",
    riskTier: "LOW",
    story:
      "Switchgear assembly in Madurai. Long-tenured supplier with the strongest collections on the platform.",
    shape: {
      dailyOutflowPaise: 350000,
      endingRunwayDays: 26,
      paymentRegularity: 0.95,
      volatility: 0.08,
      deteriorating: false,
    },
  },
];

/** Days of observation history generated per supplier. */
export const OBSERVATION_DAYS = 30;

/**
 * The receivable a supplier has at stake: daily revenue x the collection cycle.
 *
 * Exported so the seed and the verifier compute it the same way. They used to
 * disagree — the seed derived it from the profile while the verifier passed a
 * hardcoded Rs 1,50,000 for every supplier — which meant the verifier was
 * exercising offer sizes that no seeded supplier actually had, and the
 * maker-checker check silently stopped firing when the two drifted apart.
 */
export function receivableAtStakePaise(profile: SupplierProfile): number {
  const dailyRevenuePaise =
    profile.shape.dailyOutflowPaise / ASSUMPTIONS.outflowShareOfTurnover.value;
  return Math.round(
    dailyRevenuePaise * PAYMENT_BEHAVIOUR.averageRealisedDays.value
  );
}

export interface GeneratedObservation {
  observedAt: Date;
  availableBalancePaise: number;
  inflowPaise: number;
  outflowPaise: number;
  daysRunway: number;
  paymentRegularity: number;
  volatility: number;
  source: string;
}

/**
 * Deterministic pseudo-random in [0, 1), seeded per supplier and day so the
 * demo produces the same numbers on every machine.
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Generate a supplier's observation history, walking backwards from today.
 *
 * A deteriorating supplier starts the window with comfortable cover and ends it
 * near zero, which is what makes the chart in the console tell a story rather
 * than show noise.
 */
export function generateObservations(
  profile: SupplierProfile,
  seedOffset: number,
  now: Date = new Date()
): GeneratedObservation[] {
  const { shape } = profile;
  const observations: GeneratedObservation[] = [];

  // Where runway started, if this supplier is sliding.
  const startingRunwayDays = shape.deteriorating
    ? shape.endingRunwayDays + 9
    : shape.endingRunwayDays + 1.5;

  for (let dayIndex = OBSERVATION_DAYS - 1; dayIndex >= 0; dayIndex--) {
    const observedAt = new Date(now);
    observedAt.setDate(observedAt.getDate() - dayIndex);
    observedAt.setHours(23, 0, 0, 0);

    // Linear glide from starting to ending runway, plus bounded noise.
    const progress = (OBSERVATION_DAYS - 1 - dayIndex) / (OBSERVATION_DAYS - 1);
    const trendRunway =
      startingRunwayDays + (shape.endingRunwayDays - startingRunwayDays) * progress;

    const noise =
      (seededRandom(seedOffset * 1000 + dayIndex) - 0.5) *
      shape.volatility *
      3;
    const daysRunway = Math.max(trendRunway + noise, 0.3);

    const outflowPaise = Math.round(
      shape.dailyOutflowPaise *
        (1 + (seededRandom(seedOffset * 2000 + dayIndex) - 0.5) * shape.volatility)
    );

    // Inflow only arrives on the days customers actually pay.
    const paid =
      seededRandom(seedOffset * 3000 + dayIndex) < shape.paymentRegularity;
    const inflowPaise = paid
      ? Math.round(
          shape.dailyOutflowPaise *
            (1 + (seededRandom(seedOffset * 4000 + dayIndex) - 0.4) * 0.8)
        )
      : 0;

    observations.push({
      observedAt,
      availableBalancePaise: Math.round(daysRunway * outflowPaise),
      inflowPaise,
      outflowPaise,
      daysRunway: Number(daysRunway.toFixed(2)),
      paymentRegularity: Number(
        Math.min(
          Math.max(
            shape.paymentRegularity +
              (seededRandom(seedOffset * 5000 + dayIndex) - 0.5) * 0.08,
            0.05
          ),
          0.99
        ).toFixed(3)
      ),
      volatility: Number(
        Math.min(
          Math.max(
            shape.volatility +
              (seededRandom(seedOffset * 6000 + dayIndex) - 0.5) * 0.06,
            0.02
          ),
          0.95
        ).toFixed(3)
      ),
      source: "DEMO_SYNTHETIC",
    });
  }

  return observations;
}
