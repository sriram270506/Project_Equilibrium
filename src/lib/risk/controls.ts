import { prisma } from "../prisma";
import { createAuditEvent } from "../audit";

/**
 * Runtime risk controls.
 *
 * These are the limits that must hold regardless of what the model believes.
 * A model can drift, a feature pipeline can break, an operator can be tricked -
 * and none of that may result in more money leaving than the business has
 * decided it is willing to lose in a day.
 *
 * They live in the database rather than in code because the moment you need a
 * kill switch is never the moment you can wait for a deploy.
 */

export interface RiskLimits {
  killSwitchEngaged: boolean;
  killSwitchReason: string | null;
  killSwitchEngagedBy: string | null;
  killSwitchEngagedAt: Date | null;
  dailyExposureLimitPaise: number;
  perTransactionCapPaise: number;
  dualApprovalThresholdPaise: number;
  perSupplierLimitPaise: number;
}

const DEFAULT_ID = "default";

/** Read the current controls, creating the default row on first use. */
export async function getRiskLimits(): Promise<RiskLimits> {
  const existing = await prisma.riskControl.findUnique({
    where: { id: DEFAULT_ID },
  });

  if (existing) return existing;

  return prisma.riskControl.create({ data: { id: DEFAULT_ID } });
}

export interface ExposureSnapshot {
  /** Advanced so far today, across all suppliers. */
  todayPaise: number;
  /** What is left before the daily limit is hit. */
  remainingPaise: number;
  /** Fraction of the daily limit consumed, 0-1. */
  utilisation: number;
  limitPaise: number;
  paymentsToday: number;
}

/**
 * How much has already gone out today.
 *
 * Counts every payment that is not definitively failed - including UNKNOWN,
 * because a payment we cannot classify may well have moved money, and a limit
 * that ignores it would let a run of timeouts breach the cap invisibly.
 */
export async function getTodayExposure(
  limits?: RiskLimits
): Promise<ExposureSnapshot> {
  const risk = limits ?? (await getRiskLimits());

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const payments = await prisma.paymentIntent.findMany({
    where: {
      createdAt: { gte: startOfDay },
      status: { notIn: ["FAILED", "REVERSED"] },
    },
    select: { amountPaise: true },
  });

  const todayPaise = payments.reduce((sum, p) => sum + p.amountPaise, 0);

  return {
    todayPaise,
    remainingPaise: Math.max(risk.dailyExposureLimitPaise - todayPaise, 0),
    utilisation:
      risk.dailyExposureLimitPaise > 0
        ? Math.min(todayPaise / risk.dailyExposureLimitPaise, 1)
        : 0,
    limitPaise: risk.dailyExposureLimitPaise,
    paymentsToday: payments.length,
  };
}

/** Outstanding, non-failed exposure to one supplier. */
export async function getSupplierExposure(
  supplierId: string
): Promise<number> {
  const payments = await prisma.paymentIntent.findMany({
    where: {
      supplierId,
      status: { notIn: ["FAILED", "REVERSED"] },
    },
    select: { amountPaise: true },
  });
  return payments.reduce((sum, p) => sum + p.amountPaise, 0);
}

export interface RiskDecision {
  allowed: boolean;
  /** True when the amount clears every limit but needs a second approver. */
  requiresDualApproval: boolean;
  /** Machine-readable reasons this was blocked. */
  violations: Array<{
    control: string;
    message: string;
  }>;
  exposure: ExposureSnapshot;
  limits: RiskLimits;
}

/**
 * Decide whether an advance of `amountPaise` to `supplierId` may proceed.
 *
 * Called before any money moves. Returns every violation rather than the first,
 * so an operator sees the whole picture instead of fixing one limit and
 * immediately hitting the next.
 */
export async function checkRiskControls(
  supplierId: string,
  amountPaise: number
): Promise<RiskDecision> {
  const limits = await getRiskLimits();
  const exposure = await getTodayExposure(limits);
  const violations: RiskDecision["violations"] = [];

  if (limits.killSwitchEngaged) {
    violations.push({
      control: "KILL_SWITCH",
      message: limits.killSwitchReason
        ? `Payments are halted: ${limits.killSwitchReason}`
        : "Payments are halted by the kill switch.",
    });
  }

  if (amountPaise > limits.perTransactionCapPaise) {
    violations.push({
      control: "PER_TRANSACTION_CAP",
      message: `Advance of ₹${(amountPaise / 100).toLocaleString("en-IN")} exceeds the per-transaction cap of ₹${(limits.perTransactionCapPaise / 100).toLocaleString("en-IN")}.`,
    });
  }

  if (exposure.todayPaise + amountPaise > limits.dailyExposureLimitPaise) {
    violations.push({
      control: "DAILY_EXPOSURE_LIMIT",
      message: `This would take today's total to ₹${((exposure.todayPaise + amountPaise) / 100).toLocaleString("en-IN")}, above the daily limit of ₹${(limits.dailyExposureLimitPaise / 100).toLocaleString("en-IN")}.`,
    });
  }

  const supplierExposure = await getSupplierExposure(supplierId);
  if (supplierExposure + amountPaise > limits.perSupplierLimitPaise) {
    violations.push({
      control: "PER_SUPPLIER_LIMIT",
      message: `Outstanding exposure to this supplier would reach ₹${((supplierExposure + amountPaise) / 100).toLocaleString("en-IN")}, above the per-supplier limit of ₹${(limits.perSupplierLimitPaise / 100).toLocaleString("en-IN")}.`,
    });
  }

  return {
    allowed: violations.length === 0,
    requiresDualApproval: amountPaise >= limits.dualApprovalThresholdPaise,
    violations,
    exposure,
    limits,
  };
}

/** Thrown when an advance is refused by a risk control. */
export class RiskControlError extends Error {
  constructor(
    message: string,
    public readonly violations: RiskDecision["violations"]
  ) {
    super(message);
    this.name = "RiskControlError";
  }
}

/** Engage or release the kill switch, with an audit entry either way. */
export async function setKillSwitch(
  engaged: boolean,
  actorId: string,
  reason?: string
): Promise<RiskLimits> {
  await getRiskLimits(); // ensure the row exists

  const updated = await prisma.riskControl.update({
    where: { id: DEFAULT_ID },
    data: {
      killSwitchEngaged: engaged,
      killSwitchReason: engaged ? (reason ?? "No reason given") : null,
      killSwitchEngagedBy: engaged ? actorId : null,
      killSwitchEngagedAt: engaged ? new Date() : null,
      updatedBy: actorId,
    },
  });

  await createAuditEvent({
    eventType: engaged ? "KILL_SWITCH_ENGAGED" : "KILL_SWITCH_RELEASED",
    actorType: "OPERATOR",
    actorId,
    aggregateType: "RISK_CONTROL",
    aggregateId: DEFAULT_ID,
    payload: { engaged, reason: reason ?? null },
  });

  return updated;
}

/** Update the numeric limits. */
export async function updateRiskLimits(
  changes: Partial<
    Pick<
      RiskLimits,
      | "dailyExposureLimitPaise"
      | "perTransactionCapPaise"
      | "dualApprovalThresholdPaise"
      | "perSupplierLimitPaise"
    >
  >,
  actorId: string
): Promise<RiskLimits> {
  await getRiskLimits();

  const updated = await prisma.riskControl.update({
    where: { id: DEFAULT_ID },
    data: { ...changes, updatedBy: actorId },
  });

  await createAuditEvent({
    eventType: "RISK_LIMITS_UPDATED",
    actorType: "OPERATOR",
    actorId,
    aggregateType: "RISK_CONTROL",
    aggregateId: DEFAULT_ID,
    payload: changes as Record<string, unknown>,
  });

  return updated;
}
