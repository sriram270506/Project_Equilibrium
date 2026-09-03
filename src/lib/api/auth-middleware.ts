import { NextRequest, NextResponse } from "next/server";
import { resolveCaller, roleSatisfies, Role } from "../auth/guard";
import { prisma } from "../prisma";
import { UnauthorizedError, ForbiddenError } from "../errors";
import { errorEnvelope } from "../api-envelope";
import { getTenantContext, TenantContext } from "../tenancy/tenant-context";

export type UserRole = "VIEWER" | "OPERATOR" | "APPROVER" | "ADMIN";

export interface AuthContext {
  userId: string;
  role: string;
  tenantContext?: TenantContext;
}

/**
 * Require authentication and optionally check role
 * Returns auth context or throws UnauthorizedError
 */
export async function requireAuth(
  request: NextRequest,
  requiredRole?: UserRole,
  withTenant: boolean = true
) {
  let caller = await resolveCaller(request);

  /*
   * Demo-mode fallback, matching the behaviour in auth/guard.ts.
   *
   * The walkthrough runs from a browser with no key management, so in demo mode
   * an unauthenticated request acts as the seeded operator. Without this the
   * demo's own UI cannot call its own endpoints - which is exactly what
   * happened when this middleware was introduced alongside the older guard.
   *
   * It fails closed outside demo mode: a convenience that silently survives
   * into production is a vulnerability, not a convenience.
   */
  if (!caller && isDemoMode()) {
    caller = await demoFallbackCaller();
  }

  if (!caller) {
    throw new UnauthorizedError("Missing or invalid API key");
  }

  if (requiredRole) {
    // Role hierarchy, not maker-checker. canOperatorApprove answers a different
    // question (may THIS person second-approve THAT payment) and using it here
    // would have compared a role string against a role string as though it were
    // an identity check.
    const hasRole = roleSatisfies(caller.role as Role, requiredRole as Role);
    if (!hasRole) {
      throw new ForbiddenError(
        `Insufficient permissions. Required: ${requiredRole}, got: ${caller.role}`
      );
    }
  }

  const authContext: AuthContext = {
    userId: caller.userId,
    role: caller.role,
  };

  // Extract tenant context if requested
  if (withTenant) {
    authContext.tenantContext = await getTenantContext(request, caller.userId);
  }

  return authContext;
}

/**
 * Middleware wrapper for protected routes
 * Usage: export const POST = withAuth("OPERATOR", async (request) => { ... })
 */
/**
 * `...rest` matters: App Router hands dynamic routes a second argument holding
 * the route params. Typing the handler as `(req) => ...` silently dropped it,
 * so any wrapped handler on a `[id]` route lost access to its own id.
 */
export function withAuth<
  T extends (req: NextRequest, ...rest: never[]) => Promise<NextResponse>,
>(
  requiredRole: UserRole,
  handler: T,
  options: { withTenant?: boolean } = {}
): T {
  const { withTenant = true } = options;

  return (async (request: NextRequest, ...rest: never[]) => {
    try {
      const authContext = await requireAuth(request, requiredRole, withTenant);

      // Attach auth context to request for use in handler
      (request as any).authContext = authContext;

      return await handler(request, ...rest);
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
 * Get auth context from request (assumes withAuth middleware ran)
 */
export function getAuthContext(request: NextRequest): AuthContext {
  const context = (request as any).authContext;
  if (!context) {
    throw new UnauthorizedError("Auth context not available");
  }
  return context;
}

/**
 * Get caller from request (legacy, use getAuthContext instead)
 */
export function getCaller(request: NextRequest) {
  const context = getAuthContext(request);
  return {
    userId: context.userId,
    role: context.role,
  };
}

function isDemoMode(): boolean {
  return (process.env.APP_MODE || "demo") === "demo";
}

/**
 * The identity unauthenticated demo requests act as. Read from the database so
 * the audit trail still names a real user and a real tenant membership.
 */
async function demoFallbackCaller() {
  const membership = await prisma.tenantUser.findFirst({
    where: {
      role: "OPERATOR",
      isActive: true,
      user: { isActive: true },
      tenant: { isActive: true },
    },
    include: { user: true, tenant: true },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) return null;

  return {
    userId: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role as Role,
    tenantId: membership.tenantId,
    tenantSlug: membership.tenant.slug,
  };
}
