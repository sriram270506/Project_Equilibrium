/**
 * Payment state machine - valid transitions
 * Defines the finite state machine for payment intent lifecycle
 */

export type PaymentStatus =
  | "INTENT_CREATED"
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "UNKNOWN"
  | "CONFIRMED"
  | "FAILED"
  | "REVERSED"
  | "MANUAL_REVIEW";

export type OpportunityStatus =
  | "RECOMMENDED"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "EXPIRED";

export type ReconciliationStatus =
  | "OPEN"
  | "INVESTIGATING"
  | "RESOLVED"
  | "FROZEN";

/**
 * Valid state transitions for payments
 * Maps from state to array of allowed target states
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  INTENT_CREATED: ["SUBMITTED", "FAILED"],
  SUBMITTED: ["ACKNOWLEDGED", "UNKNOWN", "CONFIRMED", "FAILED"],
  ACKNOWLEDGED: ["CONFIRMED", "UNKNOWN", "FAILED"],
  UNKNOWN: ["CONFIRMED", "FAILED", "MANUAL_REVIEW"],
  CONFIRMED: ["REVERSED", "MANUAL_REVIEW"], // Terminal unless reversed
  FAILED: ["MANUAL_REVIEW"], // Can escalate to manual review
  REVERSED: [], // Terminal
  MANUAL_REVIEW: ["CONFIRMED", "FAILED", "REVERSED"], // Can transition after review
};

/**
 * Valid state transitions for opportunities
 * Maps from state to array of allowed target states
 */
export const OPPORTUNITY_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  RECOMMENDED: ["APPROVED", "REJECTED"],
  APPROVED: ["EXECUTED", "EXPIRED"],
  REJECTED: [], // Terminal
  EXECUTED: [], // Terminal
  EXPIRED: [], // Terminal
};

/**
 * Valid state transitions for reconciliation cases
 * Maps from state to array of allowed target states
 */
export const RECONCILIATION_TRANSITIONS: Record<ReconciliationStatus, ReconciliationStatus[]> = {
  OPEN: ["INVESTIGATING", "RESOLVED", "FROZEN"],
  INVESTIGATING: ["RESOLVED", "FROZEN"],
  RESOLVED: [], // Terminal
  FROZEN: ["INVESTIGATING", "RESOLVED"], // Can unfreeze to investigate or resolve
};

/**
 * Assert that a state transition is valid
 * Throws error if transition is not allowed
 */
export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus
): void {
  if (from === to) {
    // No-op transitions are allowed
    return;
  }

  const allowed = PAYMENT_TRANSITIONS[from];
  if (!allowed) {
    throw new Error(
      `Invalid payment status: ${from} is not a recognized status`
    );
  }

  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid payment transition: cannot go from ${from} to ${to}. Allowed: ${allowed.join(", ")}`
    );
  }
}

/**
 * Assert that an opportunity state transition is valid
 * Throws error if transition is not allowed
 */
export function assertOpportunityTransition(
  from: OpportunityStatus,
  to: OpportunityStatus
): void {
  if (from === to) {
    // No-op transitions are allowed
    return;
  }

  const allowed = OPPORTUNITY_TRANSITIONS[from];
  if (!allowed) {
    throw new Error(
      `Invalid opportunity status: ${from} is not a recognized status`
    );
  }

  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid opportunity transition: cannot go from ${from} to ${to}. Allowed: ${allowed.join(", ")}`
    );
  }
}

/**
 * Assert that a reconciliation state transition is valid
 * Throws error if transition is not allowed
 */
export function assertReconciliationTransition(
  from: ReconciliationStatus,
  to: ReconciliationStatus
): void {
  if (from === to) {
    // No-op transitions are allowed
    return;
  }

  const allowed = RECONCILIATION_TRANSITIONS[from];
  if (!allowed) {
    throw new Error(
      `Invalid reconciliation status: ${from} is not a recognized status`
    );
  }

  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid reconciliation transition: cannot go from ${from} to ${to}. Allowed: ${allowed.join(", ")}`
    );
  }
}

/**
 * Check if a payment status is terminal (no further changes expected)
 */
export function isPaymentTerminal(status: PaymentStatus): boolean {
  return status === "CONFIRMED" || status === "FAILED" || status === "REVERSED";
}

/**
 * Check if an opportunity status is terminal
 */
export function isOpportunityTerminal(status: OpportunityStatus): boolean {
  return status === "REJECTED" || status === "EXECUTED" || status === "EXPIRED";
}

/**
 * Check if a reconciliation status is terminal
 */
export function isReconciliationTerminal(status: ReconciliationStatus): boolean {
  return status === "RESOLVED";
}
