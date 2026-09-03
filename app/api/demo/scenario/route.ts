import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successEnvelope } from "@/src/lib/api-envelope";
import { assertDemoMode } from "@/src/lib/env";
import {
  runScenarioStep,
  SCENARIO_STEPS,
  ScenarioStepId,
} from "@/src/lib/demo/scenario";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import { withAuth, getAuthContext } from "@/src/lib/api/auth-middleware";
import { ValidationError } from "@/src/lib/errors";

const requestSchema = z.object({
  step: z.enum([
    "reset",
    "score",
    "approve",
    "timeout",
    "duplicate_webhook",
    "reconcile",
    "prove",
  ]),
  context: z.record(z.string()).optional(),
});

/** List the steps so the UI does not have to hardcode them. */
export async function GET() {
  return NextResponse.json(successEnvelope({ steps: SCENARIO_STEPS }));
}

/** Run one step of the guided walkthrough against the real services. */
export const POST = withErrorHandler(
  withAuth("OPERATOR", async (request: NextRequest) => {
    const authContext = getAuthContext(request);
    assertDemoMode(); // Demo-only endpoint

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Invalid scenario step", {
        issues: parsed.error.issues,
      });
    }

    const tenantId = authContext.tenantContext?.tenantId;
    const result = await runScenarioStep(
      parsed.data.step as ScenarioStepId,
      parsed.data.context ?? {},
      authContext.userId,
      tenantId
    );

    return NextResponse.json(successEnvelope(result));
  })
);
