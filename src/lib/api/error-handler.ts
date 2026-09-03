import { NextResponse } from "next/server";
import { ApplicationError } from "../errors";
import { errorEnvelope } from "../api-envelope";

/**
 * Standardized API error handler middleware
 * Converts all error types to consistent response format
 */
export function handleApiError(error: unknown): NextResponse {
  // Known application error
  if (error instanceof ApplicationError) {
    return NextResponse.json(
      errorEnvelope(error.code, error.message, error.details),
      { status: error.statusCode }
    );
  }

  // Zod validation error
  if (error instanceof Error && error.message.includes("Zod")) {
    return NextResponse.json(
      errorEnvelope(
        "VALIDATION_ERROR",
        error.message,
        { raw: error.message }
      ),
      { status: 400 }
    );
  }

  // Generic error
  const message = error instanceof Error ? error.message : String(error);
  console.error("Unhandled error:", error);

  return NextResponse.json(
    errorEnvelope(
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      { 
        details: process.env.NODE_ENV === "development" ? message : undefined 
      }
    ),
    { status: 500 }
  );
}

/**
 * Wrap a route handler to automatically handle errors
 */
export function withErrorHandler<T extends (...args: any[]) => any>(
  handler: T
): T {
  return (async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleApiError(error);
    }
  }) as T;
}
