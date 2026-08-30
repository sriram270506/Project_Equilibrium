import { prisma } from "./prisma";
import { generateId } from "./ids";

export type ActorType = "SYSTEM" | "OPERATOR" | "PROVIDER" | "MODEL";

export interface AuditEventInput {
  eventType: string;
  actorType: ActorType;
  actorId: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  modelVersion?: string;
  policyVersion?: string;
  correlationId?: string;
  supplierId?: string;
}

/**
 * Create an immutable audit event
 */
export async function createAuditEvent(
  input: AuditEventInput
): Promise<string> {
  const auditId = generateId();

  await prisma.auditEvent.create({
    data: {
      id: auditId,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payloadJson: JSON.stringify(input.payload),
      modelVersion: input.modelVersion,
      policyVersion: input.policyVersion,
      correlationId: input.correlationId || generateId("corr"),
      supplierId: input.supplierId,
    },
  });

  return auditId;
}

/**
 * Get audit trail for an aggregate
 */
export async function getAuditTrail(
  aggregateType: string,
  aggregateId: string
) {
  return prisma.auditEvent.findMany({
    where: {
      aggregateType,
      aggregateId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}
