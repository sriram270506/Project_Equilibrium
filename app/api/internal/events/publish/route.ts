import { publishPendingEvents } from "@/src/lib/events/event-service";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";

/**
 * Drain pending outbox events and publish them to event stream
 * Internal route - should be called by cron or background worker
 * POST /api/internal/events/publish
 */
export async function POST(request: NextRequest) {
  try {
    // In a real system, this would be protected by a secret or auth
    // For demo, we allow it but log the caller
    const body = await request.json().catch(() => ({}));

    // Optional: limit the number of attempts
    const maxAttempts = body.maxAttempts || 3;

    // Publish pending events
    await publishPendingEvents(maxAttempts);

    return NextResponse.json(
      successEnvelope({
        message: "Outbox drain completed",
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error("Error publishing pending events:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to publish pending events"),
      { status: 500 }
    );
  }
}

/**
 * GET /api/internal/events/publish - health check
 */
export async function GET() {
  return NextResponse.json(
    successEnvelope({
      message: "Outbox publish endpoint is healthy",
      usage: "POST /api/internal/events/publish to drain pending events",
    })
  );
}
