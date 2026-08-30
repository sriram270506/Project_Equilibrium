import { z } from "zod";

// Common schemas
export const UUIDSchema = z.string().uuid();
export const CorrelationIdSchema = z.string().min(1);
export const IdempotencyKeySchema = z.string().min(1);

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
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const ApproveOpportunityRequestSchema = z.object({
  opportunityId: z.string(),
  correlationId: z.string().optional(),
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
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
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

export const ResolveReconciliationRequestSchema = z.object({
  caseId: z.string(),
  resolution: z.enum(["ACCEPT", "INVESTIGATE", "FREEZE"]),
  notes: z.string().min(1),
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
