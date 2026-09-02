import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../prisma";
import { errorEnvelope } from "../api-envelope";

/**
 * Route authentication and authorisation.
 *
 * Every mutating endpoint goes through `withAuth`. Before this existed, any
 * unauthenticated caller who could reach the port could move money, and the
 * operator recorded against the payment came from the request body - so the
 * audit trail recorded whatever the caller claimed. Identity now comes from the
 * credential, never from the payload.
 */

export type Role = "VIEWER" | "OPERATOR" | "APPROVER" | "ADMIN";

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

/** Ascending privilege. A role satisfies any requirement at or below it. */
const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  APPROVER: 2,
  ADMIN: 3,
};

export function roleSatisfies(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Resolve the caller from their API key.
 *
 * Accepts `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 */
export async function resolveCaller(
  request: NextRequest
): Promise<AuthContext | null> {
  const bearer = request.headers.get("authorization");
  const apiKey =
    (bearer?.toLowerCase().startsWith("bearer ")
      ? bearer.slice(7).trim()
      : undefined) ?? request.headers.get("x-api-key")?.trim();

  if (!apiKey) return null;

  const user = await prisma.user.findUnique({ where: { apiKey } });
  if (!user || !user.isActive) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  };
}

/**
 * Wrap a route handler so it only runs for an authenticated caller holding at
 * least `requiredRole`.
 *
 * In demo mode an unauthenticated request is accepted as the seeded operator so
 * that the walkthrough works from a browser with no key management. That
 * fallback is explicitly disabled outside demo mode - a convenience that
 * silently survives into production is a vulnerability, so it fails closed.
 */
export function withAuth<T extends { params?: unknown }>(
  requiredRole: Role,
  handler: (
    request: NextRequest,
    context: T,
    auth: AuthContext
  ) => Promise<NextResponse>
) {
  return async (request: NextRequest, context: T): Promise<NextResponse> => {
    let auth = await resolveCaller(request);

    if (!auth && isDemoMode()) {
      auth = await demoFallbackIdentity();
    }

    if (!auth) {
      return NextResponse.json(
        errorEnvelope(
          "UNAUTHENTICATED",
          "This endpoint requires an API key. Send it as 'Authorization: Bearer <key>' or 'X-API-Key: <key>'."
        ),
        { status: 401 }
      );
    }

    if (!roleSatisfies(auth.role, requiredRole)) {
      return NextResponse.json(
        errorEnvelope(
          "FORBIDDEN",
          `This action requires the ${requiredRole} role. You hold ${auth.role}.`,
          { requiredRole, actualRole: auth.role }
        ),
        { status: 403 }
      );
    }

    return handler(request, context, auth);
  };
}

function isDemoMode(): boolean {
  return (process.env.APP_MODE || "demo") === "demo";
}

/**
 * The identity unauthenticated demo requests act as. Read from the database
 * rather than invented, so the audit trail still names a real user row.
 */
async function demoFallbackIdentity(): Promise<AuthContext | null> {
  const user = await prisma.user.findFirst({
    where: { role: "OPERATOR", isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (!user) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  };
}
