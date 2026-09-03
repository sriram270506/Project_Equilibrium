import { prisma } from "../prisma";

/**
 * Tenancy constants and resolution.
 *
 * Every business record carries a `tenantId`, and it is NOT nullable. That is
 * deliberate: a nullable tenant column means a row can exist outside every
 * tenant's scope, and a scoped query with `where: { tenantId }` will silently
 * skip it. Rows that belong to nobody are how cross-tenant leaks and orphaned
 * records happen, so the schema refuses to allow them.
 *
 * The demo runs as a single tenant. Internal callers that have no request
 * context — the seed, the verifier, background scripts — resolve to that one.
 * Request-handling code must take the tenant from the authenticated caller
 * instead, never from this default.
 */

export const DEFAULT_TENANT_ID = "tenant_demo";
export const DEFAULT_TENANT_SLUG = "demo-marketplace";
export const DEFAULT_TENANT_NAME = "Demo Marketplace";

let cachedDefaultTenantId: string | null = null;

/**
 * The tenant that internal, non-request callers act as.
 *
 * Resolves the seeded demo tenant, falling back to the first active tenant so
 * a differently-seeded database still works. Throws rather than inventing one:
 * silently creating a tenant here would let a misconfigured deployment write
 * business records into a tenant nobody can see.
 */
export async function resolveInternalTenantId(): Promise<string> {
  if (cachedDefaultTenantId) return cachedDefaultTenantId;

  const preferred = await prisma.tenant.findUnique({
    where: { id: DEFAULT_TENANT_ID },
    select: { id: true },
  });

  if (preferred) {
    cachedDefaultTenantId = preferred.id;
    return preferred.id;
  }

  const anyTenant = await prisma.tenant.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!anyTenant) {
    throw new Error(
      "No active tenant exists. Run `npm run db:seed` before performing tenant-scoped work."
    );
  }

  cachedDefaultTenantId = anyTenant.id;
  return anyTenant.id;
}

/** Test hook, and used by the seed after it recreates the tenant row. */
export function clearTenantCache(): void {
  cachedDefaultTenantId = null;
}
