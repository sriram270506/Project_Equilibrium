import { generateCorrelationId } from "./ids";

// Storage for correlation context during request
const correlationContext = new Map<string, string>();

/**
 * Get or create correlation ID for current operation
 */
export function getOrCreateCorrelationId(): string {
  // In a real app, this would use context-local storage or AsyncLocalStorage
  // For now, we generate per-operation
  return generateCorrelationId();
}

/**
 * Set correlation ID for current operation
 */
export function setCorrelationId(correlationId: string): void {
  correlationContext.set("current", correlationId);
}

/**
 * Retrieve current correlation ID
 */
export function getCurrentCorrelationId(): string | undefined {
  return correlationContext.get("current");
}

/**
 * Clear correlation context (for cleanup between tests)
 */
export function clearCorrelationContext(): void {
  correlationContext.clear();
}
