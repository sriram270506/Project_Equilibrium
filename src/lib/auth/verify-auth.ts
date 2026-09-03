import { NextRequest } from "next/server";
import { resolveCaller, AuthContext } from "./guard";

/**
 * Legacy entry points, kept so older imports keep working.
 *
 * These used to read `role` straight off the User row. Roles now live on the
 * TenantUser membership, so both delegate to `resolveCaller`, which resolves
 * identity and per-tenant role together. Two copies of authentication logic is
 * exactly how one of them ends up out of date and permissive.
 */

export async function verifyAuth(
  request: NextRequest
): Promise<AuthContext | null> {
  return resolveCaller(request);
}

export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const auth = await resolveCaller(request);
  if (!auth) throw new Error("UNAUTHORIZED");
  return auth;
}

export type { AuthContext };
