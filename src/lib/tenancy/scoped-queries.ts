/**
 * Tenant-scoped query builders
 * All queries are automatically scoped by tenantId
 * Prevents data leakage between tenants
 */

import { prisma } from "../prisma";

export const scopedQueries = {
  /**
   * Find suppliers only visible to this tenant
   */
  async findSuppliers(tenantId: string, where?: any) {
    return prisma.supplier.findMany({
      where: {
        ...where,
        tenantId,
      },
    });
  },

  /**
   * Find supplier by ID, scoped to tenant
   */
  async findSupplierById(tenantId: string, supplierId: string) {
    return prisma.supplier.findFirst({
      where: {
        id: supplierId,
        tenantId,
      },
    });
  },

  /**
   * Find payments only visible to this tenant
   */
  async findPayments(tenantId: string, where?: any) {
    return prisma.paymentIntent.findMany({
      where: {
        ...where,
        tenantId,
      },
    });
  },

  /**
   * Find payment by ID, scoped to tenant
   */
  async findPaymentById(tenantId: string, paymentId: string) {
    return prisma.paymentIntent.findFirst({
      where: {
        id: paymentId,
        tenantId,
      },
    });
  },

  /**
   * Find opportunities only visible to this tenant
   */
  async findOpportunities(tenantId: string, where?: any) {
    return prisma.liquidityOpportunity.findMany({
      where: {
        ...where,
        tenantId,
      },
    });
  },

  /**
   * Find opportunity by ID, scoped to tenant
   */
  async findOpportunityById(tenantId: string, opportunityId: string) {
    return prisma.liquidityOpportunity.findFirst({
      where: {
        id: opportunityId,
        tenantId,
      },
    });
  },

  /**
   * Find disputes only visible to this tenant
   */
  async findDisputes(tenantId: string, where?: any) {
    return prisma.disputeCase.findMany({
      where: {
        ...where,
        tenantId,
      },
    });
  },

  /**
   * Find dispute by ID, scoped to tenant
   */
  async findDisputeById(tenantId: string, disputeId: string) {
    return prisma.disputeCase.findFirst({
      where: {
        id: disputeId,
        tenantId,
      },
    });
  },

  /**
   * Find audit events only visible to this tenant
   */
  async findAuditEvents(tenantId: string, where?: any) {
    return prisma.auditEvent.findMany({
      where: {
        ...where,
        tenantId,
      },
    });
  },

  /**
   * Count payments by status in tenant
   */
  async countPaymentsByStatus(tenantId: string) {
    const statuses = [
      "INTENT_CREATED",
      "SUBMITTED",
      "ACKNOWLEDGED",
      "UNKNOWN",
      "CONFIRMED",
      "FAILED",
      "REVERSED",
      "MANUAL_REVIEW",
    ];

    const counts: Record<string, number> = {};

    for (const status of statuses) {
      const count = await prisma.paymentIntent.count({
        where: {
          tenantId,
          status,
        },
      });
      counts[status] = count;
    }

    return counts;
  },

  /**
   * Count opportunities by status in tenant
   */
  async countOpportunitiesByStatus(tenantId: string) {
    const statuses = [
      "RECOMMENDED",
      "APPROVED",
      "REJECTED",
      "EXECUTED",
      "EXPIRED",
    ];

    const counts: Record<string, number> = {};

    for (const status of statuses) {
      const count = await prisma.liquidityOpportunity.count({
        where: {
          tenantId,
          status,
        },
      });
      counts[status] = count;
    }

    return counts;
  },

  /**
   * Get dashboard metrics scoped to tenant
   */
  async getDashboardMetrics(tenantId: string) {
    const [
      recommendedOppCount,
      activePaymentCount,
      totalPaiseAdvanced,
      activeDisputes,
    ] = await Promise.all([
      prisma.liquidityOpportunity.count({
        where: {
          tenantId,
          status: "RECOMMENDED",
        },
      }),
      prisma.paymentIntent.count({
        where: {
          tenantId,
          status: { in: ["SUBMITTED", "ACKNOWLEDGED", "UNKNOWN"] },
        },
      }),
      prisma.paymentIntent.aggregate({
        where: {
          tenantId,
          status: "CONFIRMED",
        },
        _sum: {
          amountPaise: true,
        },
      }),
      prisma.disputeCase.count({
        where: {
          tenantId,
          status: { in: ["OPEN", "NEEDS_REVIEW"] },
        },
      }),
    ]);

    return {
      recommendedOpportunities: recommendedOppCount,
      activePayments: activePaymentCount,
      // Read from the aggregate, not from the count. This previously read
      // `activePaymentCount._sum`, which is a number and has no `_sum` - so the
      // dashboard total was silently always zero.
      totalPaiseAdvanced: totalPaiseAdvanced._sum.amountPaise ?? 0,
      activeDisputes,
    };
  },
};

/**
 * Usage pattern in routes:
 *
 * export const GET = withAuth("VIEWER", async (request) => {
 *   const caller = getCaller(request);
 *   const { tenantId } = await getTenantContext(request, caller.userId);
 *
 *   const payments = await scopedQueries.findPayments(tenantId, {
 *     status: "CONFIRMED"
 *   });
 *
 *   return NextResponse.json(successEnvelope({ payments }));
 * });
 */
