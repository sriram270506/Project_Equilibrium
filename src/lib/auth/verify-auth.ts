import { NextRequest } from "next/server";
import { prisma } from "../prisma";
import { AuthContext } from "./auth-context";

/**
 * Extract and verify API key from request
 * Looks for Authorization: Bearer <apiKey> or X-API-Key header
 */
export async function verifyAuth(request: NextRequest): Promise<AuthContext | null> {
  try {
    // Try Authorization header first (Bearer token)
    let apiKey = request.headers.get("authorization")?.replace("Bearer ", "");

    // Fall back to X-API-Key header
    if (!apiKey) {
      apiKey = request.headers.get("x-api-key");
    }

    if (!apiKey) {
      return null;
    }

    // Look up user by API key
    const user = await prisma.user.findUnique({
      where: { apiKey },
    });

    if (!user || !user.isActive) {
      return null;
    }

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "VIEWER" | "OPERATOR" | "APPROVER" | "ADMIN",
    };
  } catch (error) {
    console.error("Error verifying auth:", error);
    return null;
  }
}

/**
 * Require authentication middleware
 * Returns auth context or null if authentication failed
 */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const auth = await verifyAuth(request);
  if (!auth) {
    throw new Error("UNAUTHORIZED");
  }
  return auth;
}
