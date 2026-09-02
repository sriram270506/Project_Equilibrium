/**
 * The cast of the demo.
 *
 * Six suppliers with deliberately different cash-flow shapes, so that scoring
 * them produces a real spread rather than a uniform result. Two are in genuine
 * distress, one is borderline, and three are healthy - which is roughly the mix
 * a marketplace actually sees, and it lets the walkthrough show policy
 * rejecting offers as well as approving them.
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
  /** Cash-flow shape used to generate observations. */
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
      "Machine parts for two large OEMs. Reliable revenue, but both customers pay on 45-day terms and payroll is weekly.",
    shape: {
      dailyOutflowPaise: 62000,
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
      "Truck spares distributor. Thin margins, lumpy demand, and a customer base that pays late as a matter of habit.",
    shape: {
      dailyOutflowPaise: 48000,
      endingRunwayDays: 1.8,
      paymentRegularity: 0.42,
      volatility: 0.44,
      deteriorating: true,
    },
  },
  {
    name: "Nila Packaging Works",
    email: "admin@nila.in",
    riskTier: "MEDIUM",
    story:
      "Corrugated packaging. Seasonal, and currently between two large orders - borderline rather than distressed.",
    shape: {
      dailyOutflowPaise: 38000,
      endingRunwayDays: 6.5,
      paymentRegularity: 0.71,
      volatility: 0.26,
      deteriorating: true,
    },
  },
  {
    name: "Saffron Retail Supply",
    email: "ops@saffron.in",
    riskTier: "MEDIUM",
    story:
      "FMCG distributor with a broad retail base. Many small customers paying quickly smooths the cash curve.",
    shape: {
      dailyOutflowPaise: 55000,
      endingRunwayDays: 16,
      paymentRegularity: 0.88,
      volatility: 0.14,
      deteriorating: false,
    },
  },
  {
    name: "Meridian Home Goods",
    email: "finance@meridian.in",
    riskTier: "LOW",
    story:
      "Established homeware brand. Holds a working-capital buffer by policy and collects promptly.",
    shape: {
      dailyOutflowPaise: 71000,
      endingRunwayDays: 22,
      paymentRegularity: 0.93,
      volatility: 0.09,
      deteriorating: false,
    },
  },
  {
    name: "Orbit Kitchenware",
    email: "finance@orbit.in",
    riskTier: "MEDIUM",
    story:
      "Kitchen equipment for restaurants. Steady repeat orders and disciplined collections.",
    shape: {
      dailyOutflowPaise: 44000,
      endingRunwayDays: 13,
      paymentRegularity: 0.85,
      volatility: 0.17,
      deteriorating: false,
    },
  },
];

/** Days of observation history generated per supplier. */
export const OBSERVATION_DAYS = 30;

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
