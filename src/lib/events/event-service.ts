import { prisma } from "../prisma";
import { generateId } from "../ids";

export interface DomainEvent {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  sequenceNumber: number;
  schemaVersion: string;
  payload: Record<string, unknown>;
  source: string;
  correlationId: string;
}

/**
 * Append event to event stream for aggregate
 */
export async function appendEvent(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
  correlationId: string,
  /**
   * Override the idempotency key. Provider webhooks pass the provider's own
   * event id so a redelivery collides on the unique index instead of appending
   * a second copy.
   */
  idempotencyKeyOverride?: string
): Promise<string> {
  // Get next sequence number for this aggregate
  const lastEvent = await prisma.eventRecord.findFirst({
    where: {
      aggregateType,
      aggregateId,
    },
    orderBy: {
      sequenceNumber: "desc",
    },
  });

  const sequenceNumber = (lastEvent?.sequenceNumber || 0) + 1;
  const eventId = generateId();

  await prisma.eventRecord.create({
    data: {
      id: eventId,
      eventType,
      aggregateType,
      aggregateId,
      sequenceNumber,
      schemaVersion: "1.0",
      payloadJson: JSON.stringify(payload),
      source: "INTERNAL",
      idempotencyKey:
        idempotencyKeyOverride ?? `${aggregateId}_${sequenceNumber}`,
      correlationId,
    },
  });

  return eventId;
}

/**
 * Get event stream for aggregate
 */
export async function getEventStream(
  aggregateType: string,
  aggregateId: string
) {
  return prisma.eventRecord.findMany({
    where: {
      aggregateType,
      aggregateId,
    },
    orderBy: {
      sequenceNumber: "asc",
    },
  });
}

/**
 * Create outbox event for eventual publishing
 */
export async function createOutboxEvent(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  correlationId: string,
  paymentIntentId?: string
): Promise<string> {
  const outboxId = generateId();

  await prisma.outboxEvent.create({
    data: {
      id: outboxId,
      eventType,
      aggregateType,
      aggregateId,
      payloadJson: JSON.stringify(payload),
      status: "PENDING",
      correlationId,
      paymentIntentId,
    },
  });

  return outboxId;
}

/**
 * Publish pending outbox events
 */
export async function publishPendingEvents(maxAttempts: number = 3) {
  const pendingEvents = await prisma.outboxEvent.findMany({
    where: {
      status: "PENDING",
      availableAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 100,
  });

  for (const event of pendingEvents) {
    try {
      // Publish to event stream
      await appendEvent(
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        JSON.parse(event.payloadJson),
        event.correlationId
      );

      // Mark as published
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });
    } catch (error) {
      // Mark attempt
      const newAttemptCount = event.attemptCount + 1;

      if (newAttemptCount >= maxAttempts) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            attemptCount: newAttemptCount,
            lastError: (error as Error).message,
          },
        });
      } else {
        // Exponential backoff
        const backoffMs = Math.min(
          1000 * Math.pow(2, newAttemptCount),
          300000
        );
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attemptCount: newAttemptCount,
            availableAt: new Date(Date.now() + backoffMs),
            lastError: (error as Error).message,
          },
        });
      }
    }
  }
}

/**
 * Get failed outbox events
 */
export async function getFailedOutboxEvents() {
  return prisma.outboxEvent.findMany({
    where: {
      status: "FAILED",
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}
