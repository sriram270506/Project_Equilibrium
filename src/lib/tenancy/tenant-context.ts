/**
 * Tenant context and scoped query helpers
 * Ensures all queries are automatically scoped to the authenticated user's tenant(s)
 */

import { NextRequest } from "next/server";
import { prisma } from "../prisma";
import { UnauthorizedError } from "../errors";

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  roles: string[]; // Per-tenant roles (could differ across tenants)
}

/**
 * Extract tenant context from request
 * User -> TenantUser -> Tenant
 */
export async function getTenantContext(
  _request: NextRequest,
  userId: string
): Promise<TenantContext> {
  // For now, assume single-tenant (first tenant user belongs to)
  // Future: support multi-tenant with tenant ID from header/params

  const tenantUser = await prisma.tenantUser.findFirst({
    where: {
      userId,
      isActive: true,
    },
    include: {
      tenant: true,
    },
  });

  if (!tenantUser) {
    throw new UnauthorizedError("User not assigned to any active tenant");
  }

  return {
    tenantId: tenantUser.tenantId,
    tenantSlug: tenantUser.tenant.slug,
    userId,
    roles: [tenantUser.role],
  };
}

/**
 * Verify user has access to a specific tenant
 */
export async function verifyTenantAccess(
  userId: string,
  tenantId: string
): Promise<void> {
  const access = await prisma.tenantUser.findUnique({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
  });

  if (!access || !access.isActive) {
    throw new UnauthorizedError(
      "Access denied: User does not have access to this tenant"
    );
  }
}

/**
 * Check if user has a specific role in a tenant
 */
export async function hasTenantRole(
  userId: string,
  tenantId: string,
  requiredRole: string
): Promise<boolean> {
  const tenantUser = await prisma.tenantUser.findUnique({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
  });

  if (!tenantUser || !tenantUser.isActive) {
    return false;
  }

  // Role hierarchy: VIEWER < OPERATOR < APPROVER < ADMIN
  const roleHierarchy: Record<string, number> = {
    VIEWER: 0,
    OPERATOR: 1,
    APPROVER: 2,
    ADMIN: 3,
  };

  const userRoleLevel = roleHierarchy[tenantUser.role] ?? -1;
  const requiredRoleLevel = roleHierarchy[requiredRole] ?? -1;

  return userRoleLevel >= requiredRoleLevel;
}

/**
 * Create a tenant with default user
 */
export async function createTenant(
  name: string,
  slug: string,
  userId: string,
  role: string = "ADMIN"
) {
  const tenant = await prisma.tenant.create({
    data: {
      name,
      slug,
      users: {
        create: {
          userId,
          role,
        },
      },
    },
    include: {
      users: true,
    },
  });

  return tenant;
}

/**
 * Add user to tenant with role
 */
export async function addUserToTenant(
  userId: string,
  tenantId: string,
  role: string
) {
  return prisma.tenantUser.create({
    data: {
      userId,
      tenantId,
      role,
    },
  });
}

/**
 * Update user's role in tenant
 */
export async function updateUserTenantRole(
  userId: string,
  tenantId: string,
  newRole: string
) {
  return prisma.tenantUser.update({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
    data: {
      role: newRole,
    },
  });
}

/**
 * Deactivate user in tenant (soft delete)
 */
export async function deactivateUserInTenant(
  userId: string,
  tenantId: string
) {
  return prisma.tenantUser.update({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
    data: {
      isActive: false,
    },
  });
}
