import { z } from "zod";

// Common schemas
export const UUIDSchema = z.string().uuid();
export const CorrelationIdSchema = z.string().min(1);
export const IdempotencyKeySchema = z.string().min(10).max(256);
export const UserRoleSchema = z.enum(["VIEWER", "OPERATOR", "APPROVER", "ADMIN"]);

// Request/Response envelopes
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    })
    .optional(),
});

// Opportunity schemas
export const OpportunitySchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  predictionProbability: z.number().min(0).max(1),
  modelVersion: z.string(),
  policyVersion: z.string(),
  expectedValuePaise: z.number().int(),
  recommendedDiscountBps: z.number().int(),
  maxAllowedDiscountPaise: z.number().int(),
  status: z.enum([
    "RECOMMENDED",
    "APPROVED",
    "REJECTED",
    "EXECUTED",
    "EXPIRED",
  ]),
  decisionReason: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const GetOpportunitiesQuerySchema = z.object({
  status: z
    .enum(["RECOMMENDED", "APPROVED", "REJECTED", "EXECUTED", "EXPIRED"])
    .optional(),
  riskTier: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ApproveOpportunityRequestSchema = z.object({
  opportunityId: z.string().optional(),
  correlationId: z.string().optional(),
});

export const ApproveOpportunityResponseSchema = z.object({
  paymentIntentId: z.string(),
  status: z.string(),
  correlationId: z.string(),
  message: z.string(),
});

// Payment schemas
export const PaymentIntentSchema = z.object({
  id: z.string(),
  internalReference: z.string(),
  provider: z.string(),
  providerPaymentId: z.string().nullable(),
  operationType: z.string(),
  amountPaise: z.number().int(),
  currency: z.string(),
  status: z.enum([
    "INTENT_CREATED",
    "SUBMITTED",
    "ACKNOWLEDGED",
    "UNKNOWN",
    "CONFIRMED",
    "FAILED",
    "REVERSED",
    "MANUAL_REVIEW",
  ]),
  correlationId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  confirmedAt: z.date().nullable(),
});

export const GetPaymentsQuerySchema = z.object({
  status: z.string().optional(),
  supplierId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ApprovePaymentRequestSchema = z.object({
  paymentId: z.string(),
});

export const ApprovePaymentResponseSchema = z.object({
  paymentId: z.string(),
  status: z.string(),
  checkedBy: z.string(),
  checkedAt: z.date(),
  message: z.string(),
});

// Reconciliation schemas
export const ReconciliationCaseSchema = z.object({
  id: z.string(),
  paymentIntentId: z.string().nullable(),
  outcome: z.enum([
    "MATCHED",
    "MISSING_INTERNAL",
    "MISSING_EXTERNAL",
    "AMOUNT_MISMATCH",
    "STATUS_MISMATCH",
    "DUPLICATE",
  ]),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED", "FROZEN"]),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});

export const GetReconciliationQuerySchema = z.object({
  status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED", "FROZEN"]).optional(),
  outcome: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ResolveReconciliationRequestSchema = z.object({
  caseId: z.string(),
  resolution: z.enum(["ACCEPT", "INVESTIGATE", "FREEZE"]),
  notes: z.string().min(15).max(1000),
});

export const ResolveReconciliationResponseSchema = z.object({
  caseId: z.string(),
  status: z.string(),
  resolvedBy: z.string(),
  resolvedAt: z.date(),
  message: z.string(),
});

// Dispute schemas
export const DisputeCaseSchema = z.object({
  id: z.string(),
  providerDisputeId: z.string(),
  reasonCode: z.string(),
  amountPaise: z.number().int(),
  status: z.enum(["OPEN", "DRAFT_READY", "NEEDS_REVIEW", "SUBMITTED", "CLOSED"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const GetDisputesQuerySchema = z.object({
  status: z.enum(["OPEN", "DRAFT_READY", "NEEDS_REVIEW", "SUBMITTED", "CLOSED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GenerateDisputeDraftRequestSchema = z.object({
  disputeCaseId: z.string(),
});

export const DisputeDraftSchema = z.object({
  id: z.string(),
  disputeCaseId: z.string(),
  draftText: z.string(),
  validationStatus: z.enum(["PASSED", "FAILED", "NEEDS_REVIEW"]),
  validationErrors: z.string().array().optional(),
  createdAt: z.date(),
});

// Webhook schemas
export const RazorpayWebhookSchema = z.object({
  id: z.string(),
  entity: z.string(),
  event: z.string(),
  contains: z.string().array(),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string(),
        status: z.string(),
        amount: z.number().int(),
      }),
    }),
  }),
  created_at: z.number().int(),
});

// Audit schemas
export const GetAuditQuerySchema = z.object({
  eventType: z.string().optional(),
  actorId: z.string().optional(),
  aggregateId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CorruptAuditRequestSchema = z.object({
  entryIndex: z.number().int().min(0),
});

// Health/status schemas
export const HealthCheckResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  timestamp: z.date(),
  components: z.object({
    database: z.enum(["up", "down"]),
    payments: z.enum(["up", "down"]),
    webhooks: z.enum(["up", "down"]),
  }),
  metrics: z.object({
    uptime: z.number(),
    requestsPerSecond: z.number(),
    activeConnections: z.number(),
  }),
});

// Dashboard schemas
export const DashboardSummarySchema = z.object({
  recommendedOpportunities: z.number().int(),
  expectedValuePaise: z.number().int(),
  activePaymentIntents: z.number().int(),
  openReconciliationCases: z.number().int(),
  systemStatus: z.string(),
  providerMode: z.string(),
  appMode: z.string(),
});

// Demo schemas
export const RunDemoScenarioRequestSchema = z.object({
  scenario: z.string(),
  parameters: z.record(z.unknown()).optional(),
});

export const ResetDemoRequestSchema = z.object({
  confirm: z.boolean(),
});

export const InjectFailureRequestSchema = z.object({
  failureMode: z.enum([
    "timeout_before_submit",
    "timeout_after_submit",
    "timeout_after_remote_success",
    "network_error",
    "provider_decline",
  ]),
  paymentId: z.string().optional(),
});

// Type exports for use in routes
export type OpportunityRequest = z.infer<typeof ApproveOpportunityRequestSchema>;
export type PaymentRequest = z.infer<typeof ApprovePaymentRequestSchema>;
export type ReconciliationRequest = z.infer<typeof ResolveReconciliationRequestSchema>;
export type DisputeRequest = z.infer<typeof GenerateDisputeDraftRequestSchema>;
export type WebhookRequest = z.infer<typeof RazorpayWebhookSchema>;
