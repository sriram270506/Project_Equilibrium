/**
 * Rate limit middleware for Next.js routes
 */

import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  RATE_LIMITS,
  RateLimitConfig,
} from "./rate-limit";
import { errorEnvelope } from "../api-envelope";
import { RateLimitError } from "../errors";

/**
 * Extract identifier from request
 * For webhooks: use provider signature or IP
 * For auth: use email or IP
 * For operations: use user ID from auth context
 */
export function extractIdentifier(
  request: Request,
  type: "webhook" | "auth" | "operation" = "operation"
): string {
  if (type === "webhook") {
    // Use X-Provider-Signature header or IP
    const signature = request.headers.get("x-razorpay-signature");
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    return signature || ip;
  }

  if (type === "auth") {
    // Use email from body if available, otherwise IP
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    return ip;
  }

  // For operations, identifier is passed separately
  return "default";
}

/**
 * Middleware to enforce rate limits on a route
 * Usage: export const POST = withRateLimit("webhook", async (request) => { ... })
 */
export function withRateLimit<T extends (req: NextRequest, ...args: any[]) => Promise<NextResponse>>(
  limitType: "webhook" | "auth" | "dispute" | "approval" | "apiKey",
  handler: T,
  options: { getIdentifier?: (req: NextRequest) => string } = {}
): T {
  return (async (request: NextRequest, ...rest: any[]) => {
    try {
      // Get rate limit config based on type
      let config: RateLimitConfig;
      switch (limitType) {
        case "webhook":
          config = RATE_LIMITS.webhook;
          break;
        case "auth":
          config = RATE_LIMITS.authFailure;
          break;
        case "dispute":
          config = RATE_LIMITS.dispute;
          break;
        case "approval":
          config = RATE_LIMITS.approval;
          break;
        case "apiKey":
          config = RATE_LIMITS.apiKeyValidation;
          break;
        default:
          config = RATE_LIMITS.apiKeyValidation;
      }

      // Extract identifier for rate limiting
      let identifier: string;
      if (options.getIdentifier) {
        identifier = options.getIdentifier(request);
      } else {
        identifier = extractIdentifier(request, limitType === "webhook" ? "webhook" : "operation");
      }

      // Check rate limit
      checkRateLimit(identifier, config);

      // Call handler with all arguments
      return await handler(request, ...rest);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          errorEnvelope(
            error.code,
            error.message,
            error.details
          ),
          {
            status: 429,
            headers: {
              "Retry-After": String(error.details?.retryAfter ?? 60),
            },
          }
        );
      }
      throw error;
    }
  }) as T;
}

/**
 * Middleware to track auth failures and rate limit after threshold
 * Usage in auth handlers
 */
export function trackAuthFailure(identifier: string): void {
  try {
    checkRateLimit(identifier, RATE_LIMITS.authFailure);
  } catch (error) {
    if (error instanceof RateLimitError) {
      // Log the lock for audit
      console.warn(`Auth rate limit triggered for ${identifier}`);
      throw error;
    }
  }
}

/**
 * Helper to extract user ID from auth context for operation rate limits
 */
export function getUserIdentifier(request: NextRequest): string {
  const authContext = (request as any).authContext;
  if (!authContext?.userId) {
    return "anonymous";
  }
  return authContext.userId;
}
