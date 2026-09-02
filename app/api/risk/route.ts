import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { withAuth } from "@/src/lib/auth/guard";
import {
  getRiskLimits,
  getTodayExposure,
  setKillSwitch,
  updateRiskLimits,
} from "@/src/lib/risk/controls";
import { formatPaise } from "@/src/lib/money";

/** GET /api/risk — current limits and today's utilisation. */
export const GET = withAuth("VIEWER", async () => {
  try {
    const limits = await getRiskLimits();
    const exposure = await getTodayExposure(limits);

    return NextResponse.json(
      successEnvelope({
        limits,
        exposure: {
          ...exposure,
          todayDisplay: formatPaise(exposure.todayPaise),
          remainingDisplay: formatPaise(exposure.remainingPaise),
          limitDisplay: formatPaise(exposure.limitPaise),
        },
      })
    );
  } catch (error) {
    console.error("Error reading risk controls:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to read risk controls"),
      { status: 500 }
    );
  }
});

const updateSchema = z.object({
  killSwitchEngaged: z.boolean().optional(),
  killSwitchReason: z.string().max(280).optional(),
  dailyExposureLimitPaise: z.number().int().min(0).optional(),
  perTransactionCapPaise: z.number().int().min(0).optional(),
  dualApprovalThresholdPaise: z.number().int().min(0).optional(),
  perSupplierLimitPaise: z.number().int().min(0).optional(),
});

/**
 * PATCH /api/risk — change limits or throw the kill switch.
 *
 * ADMIN only. Every change writes an audit entry naming who made it, because a
 * risk limit that can be quietly widened is not a limit.
 */
export const PATCH = withAuth("ADMIN", async (request: NextRequest, _ctx, auth) => {
  try {
    const parsed = updateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        errorEnvelope("VALIDATION_ERROR", "Invalid risk control update", {
          issues: parsed.error.issues,
        }),
        { status: 400 }
      );
    }

    const {
      killSwitchEngaged,
      killSwitchReason,
      ...numericLimits
    } = parsed.data;

    if (typeof killSwitchEngaged === "boolean") {
      await setKillSwitch(killSwitchEngaged, auth.userId, killSwitchReason);
    }

    if (Object.keys(numericLimits).length > 0) {
      await updateRiskLimits(numericLimits, auth.userId);
    }

    const limits = await getRiskLimits();
    const exposure = await getTodayExposure(limits);

    return NextResponse.json(
      successEnvelope({
        limits,
        exposure,
        changedBy: auth.name,
      })
    );
  } catch (error) {
    console.error("Error updating risk controls:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to update risk controls"),
      { status: 500 }
    );
  }
});
