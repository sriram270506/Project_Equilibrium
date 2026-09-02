import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { assertDemoMode } from "@/src/lib/env";
import {
  runScenarioStep,
  SCENARIO_STEPS,
  ScenarioStepId,
} from "@/src/lib/demo/scenario";

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
export async function POST(request: NextRequest) {
  try {
    assertDemoMode();

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        errorEnvelope(
          "VALIDATION_ERROR",
          "Invalid scenario step",
          { issues: parsed.error.issues }
        ),
        { status: 400 }
      );
    }

    const result = await runScenarioStep(
      parsed.data.step as ScenarioStepId,
      parsed.data.context ?? {}
    );

    return NextResponse.json(successEnvelope(result));
  } catch (error) {
    const message = (error as Error).message;
    console.error("Scenario step failed:", error);

    if (message.includes("demo mode")) {
      return NextResponse.json(errorEnvelope("FORBIDDEN", message), {
        status: 403,
      });
    }

    // These are expected, actionable conditions - tell the operator plainly.
    return NextResponse.json(
      errorEnvelope("STEP_FAILED", message),
      { status: 409 }
    );
  }
}
