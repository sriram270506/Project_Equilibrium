import { NextRequest, NextResponse } from "next/server";
import { resolveCaller, canOperatorApprove } from "../auth/guard";
import { UnauthorizedError, ForbiddenError } from "../errors";
import { errorEnvelope } from "../api-envelope";

export type UserRole = "VIEWER" | "OPERATOR" | "APPROVER" | "ADMIN";

/**
 * Require authentication and optionally check role
 * Returns auth context or throws UnauthorizedError
 */
export async function requireAuth(
  request: NextRequest,
  requiredRole?: UserRole
) {
  const caller = await resolveCaller(request);

  if (!caller) {
    throw new UnauthorizedError("Missing or invalid API key");
  }

  if (requiredRole) {
    const hasRole = canOperatorApprove(caller.role, requiredRole);
    if (!hasRole) {
      throw new ForbiddenError(
        `Insufficient permissions. Required: ${requiredRole}, got: ${caller.role}`
      );
    }
  }

  return caller;
}

/**
 * Middleware wrapper for protected routes
 * Usage: export const POST = withAuth("OPERATOR", async (request) => { ... })
 */
export function withAuth<T extends (req: NextRequest) => Promise<NextResponse>>(
  requiredRole: UserRole,
  handler: T
): T {
  return (async (request: NextRequest) => {
    try {
      const caller = await requireAuth(request, requiredRole);

      // Attach caller to request for use in handler
      (request as any).caller = caller;

      return await handler(request);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return NextResponse.json(
          errorEnvelope("UNAUTHORIZED", error.message),
          { status: 401 }
        );
      }
      if (error instanceof ForbiddenError) {
        return NextResponse.json(
          errorEnvelope("FORBIDDEN", error.message),
          { status: 403 }
        );
      }
      throw error;
    }
  }) as T;
}

/**
 * Get caller from request (assumes withAuth middleware ran)
 */
export function getCaller(request: NextRequest) {
  return (request as any).caller;
}
