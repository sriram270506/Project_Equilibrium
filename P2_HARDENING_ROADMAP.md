# P2 Production Hardening Roadmap

This document tracks the implementation of critical (P2) security, resilience, and compliance requirements for Project Equilibrium.

## Overview

**Scope:** 19 critical items spanning authentication, authorization, audit, compliance, and documentation.

**Current Status:** Foundation (Phase 0) complete. Phase 1 (core security) in progress.

---

## Phase 0: Foundation ✅ COMPLETE

These are the enabling infrastructure for all subsequent items.

### ✅ Error Handling Standardization
**Status:** DONE (Commit 911a126)

**What:** Expanded error class hierarchy and centralized error handler middleware.

**Files:**
- `src/lib/errors.ts` - Extended with ForbiddenError, RateLimitError, InternalError, ServiceUnavailableError
- `src/lib/api/error-handler.ts` - New withErrorHandler middleware and handleApiError function

**Impact:**
- All errors now return consistent status codes + error envelopes
- Unhandled errors caught and formatted safely
- Ready for all routes to use standardized handling

**Next:** Apply to all existing routes (12 endpoints)

---

### ✅ API Contract Centralization  
**Status:** DONE (Commit 911a126)

**What:** Comprehensive Zod schemas for all endpoints with type exports.

**Files:**
- `src/schemas/api.ts` - Extended with:
  - All missing request schemas (queries, bodies)
  - All missing response schemas
  - Query param validators (limit, offset, status)
  - Type exports for routes to use

**New schemas:**
- GetPaymentsQuerySchema, ApprovePaymentRequestSchema, ApprovePaymentResponseSchema
- GetReconciliationQuerySchema
- GetDisputesQuerySchema, InjectFailureRequestSchema
- RazorpayWebhookSchema
- AuditQuerySchema, HealthCheckResponseSchema
- And 8 more...

**Impact:**
- No API drift — types validated at request entry
- Frontend/backend types consistent
- Self-documenting schemas

**Next:** Update all routes to use these schemas

---

### ✅ Auth Middleware
**Status:** DONE (Commit 911a126)

**What:** Middleware wrapper for protecting routes + role extraction.

**Files:**
- `src/lib/api/auth-middleware.ts` - New withAuth wrapper, requireAuth function, getCaller helper

**Features:**
- `withAuth(role, handler)` - Wrap route, require role, return caller
- `requireAuth(request, role?)` - Extract caller from request, validate role
- `getCaller(request)` - Get caller attached by middleware
- Throws UnauthorizedError or ForbiddenError with correct status codes

**Usage:**
```typescript
export const POST = withAuth("OPERATOR", async (request) => {
  const caller = getCaller(request);
  // caller.userId, caller.email, caller.role
});
```

**Impact:**
- Single line to protect any route
- Consistent role checking everywhere
- Ready for all 6 unprotected mutating routes

**Next:** Wrap all mutating endpoints

---

### ✅ Idempotency Infrastructure
**Status:** DONE (Commit 911a126)

**What:** Idempotency key tracking store and helpers.

**Files:**
- `src/lib/api/idempotency-middleware.ts` - New functions for checking/marking idempotency
- `prisma/schema.prisma` - New IdempotencyKey model

**Features:**
- `extractIdempotencyKey(request)` - Validates header format (10-256 chars, alphanumeric)
- `checkIdempotency(key, type, hash)` - Returns cached result if duplicate, throws if conflict
- `markIdempotencyPending/Success/Failed` - Track operation lifecycle
- `hashRequestBody()` - SHA256 of request for conflict detection

**Database Model:**
```
IdempotencyKey {
  key (unique)
  operationType: "APPROVE_OPPORTUNITY", "APPROVE_PAYMENT", etc.
  requestHash: SHA256 of body
  operationId: Reference to financial op
  status: PENDING | SUCCESS | FAILED
  responseHash: For replay
}
```

**Impact:**
- Retried requests are safe — reuse cached response
- Prevents double charges on network retries
- Supports all financial operations

**Next:** Apply to approval, reconciliation endpoints

**Note:** Schema migration pending (file lock in Prisma). Manual migration:
```sql
CREATE TABLE "IdempotencyKey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "operationType" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "responseHash" TEXT,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME
);
CREATE INDEX "IdempotencyKey_key_idx" ON "IdempotencyKey"("key");
CREATE INDEX "IdempotencyKey_operationType_idx" ON "IdempotencyKey"("operationType");
CREATE INDEX "IdempotencyKey_status_idx" ON "IdempotencyKey"("status");
```

---

## Phase 1: Core Security (IN PROGRESS)

### [ ] Task #1: Authentication - Session Auth for Non-Demo
**Status:** Not started

**Scope:**
- Real session-based auth for production (not just API keys)
- Replace demo identity assumptions
- Operator identity always from server, never from browser
- Separate session store (Redis or DB)

**Work:**
- Add session model to Prisma
- Create session manager (create, validate, revoke)
- Update auth middleware to check sessions
- Keep API key auth for service-to-service
- Add session expiry + rotation

**Impact:** Task #2, #3, #5 depend on this

---

### [ ] Task #2: Authorization - Role Checks on All Mutating Routes
**Status:** Partially ready (middleware exists, not applied)

**Scope:**
- Apply `withAuth()` to 6 unprotected routes
- Enforce role hierarchy consistently
- Prevent privilege escalation

**Unprotected Routes:**
1. POST `/api/disputes/:id/draft` - needs OPERATOR
2. POST `/api/reconciliation/run` - needs OPERATOR
3. POST `/api/demo/reset` - demo-only, ADMIN
4. POST `/api/demo/scenario` - demo-only, OPERATOR
5. POST `/api/internal/events/publish` - internal, needs system role
6. POST `/api/webhooks/razorpay` - webhook signature (separate auth)

**Work:**
- Wrap each with `withAuth(role, handler)`
- Update demo mode bypass to require demo flag + role
- Add tests for unauthorized access

**Impact:** Blocks privilege escalation, insider threats

---

### [ ] Task #3: Tenant Isolation
**Status:** Not started

**Scope:**
- Add tenantId/platformId to all business records
- Enforce tenant-scoped queries everywhere
- Prevent cross-tenant data leakage

**Work:**
- Add tenantId to Supplier, LiquidityOpportunity, PaymentIntent, ReconciliationCase, DisputeCase
- Add TenantUser join model (user→tenants)
- Update all queries with `where: { tenantId: caller.tenantId }`
- Add database-level constraints
- Add tests for tenant boundary

**Impact:** Multi-tenant support, regulatory compliance (data isolation)

---

### [ ] Task #4: Rate Limiting
**Status:** Not started

**Scope:**
- Rate-limit webhooks, auth, expensive operations
- Prevent abuse and DoS

**Endpoints to Rate-Limit:**
- POST `/api/webhooks/razorpay` - 100/minute per API key
- POST `/api/auth/*` - 5 failed attempts → 15min lockout
- POST `/api/disputes/:id/draft` - 10/hour (expensive ML call)
- POST `/api/opportunities/:id/approve` - 100/hour per operator
- POST `/api/demo/inject` - 50/hour (demo-only)

**Work:**
- Add RateLimit store (Redis-backed or in-memory + TTL)
- Middleware: check limit before route, increment after
- Return 429 with Retry-After header
- Log rate limit events for analysis

**Impact:** Prevents abuse, protects expensive operations

---

### [ ] Task #5: Audit - Anchor Protection
**Status:** Not started

**Scope:**
- Move audit chain anchor outside mutable database
- Tamper-proof: editing both record AND anchor impossible from DB

**Current State:**
- Audit chain exists with hash verification
- But anchor lives in same database

**Work:**
- Move anchor to immutable store:
  - Option A: Blockchain-backed (Ethereum testnet, Stellar)
  - Option B: Timestamped+signed file in S3/cold storage
  - Option C: Third-party audit service (Vanta, LogicGate)
- Create `verifyAuditChain(startHash)` that reads from anchor
- Log all anchor writes (who, when, why)
- Add dashboard showing anchor status

**Impact:** Tamper-evident audit, compliance (SOC2, GDPR)

---

### [ ] Task #6: Audit - Export + Retention
**Status:** Not started

**Scope:**
- Audit export (CSV, PDF, JSON)
- Retention policy (7yr default, configurable)
- Legal hold (prevent deletion)
- Access control (auditor role)

**Work:**
- Add AuditExport model: who exported, when, filters, format
- Create export endpoint (filtered by date, actor, event type)
- Add retention policy config
- Implement legal-hold flag (blocks deletion)
- Create AUDITOR role with read-only audit access
- Add dashboard for audit retention status

**Impact:** Regulatory audit-trail, legal defensibility

---

### [ ] Task #7: Compliance - Threat Model
**Status:** Not started

**Scope:**
- Document threats and mitigations
- Cover: replay, spoofed webhooks, injection, privilege escalation, data leakage, insider mods

**Threats:**
1. **Spoofed Webhooks** → Verify HMAC signature ✅, timestamp validation
2. **Replay Attacks** → Idempotency keys ✅, webhook sequence tracking
3. **Duplicate Payments** → Idempotency ✅, test with concurrent approvals
4. **Privilege Escalation** → Role checks ✅, test self-approval prevention
5. **Prompt Injection** (ML) → Sanitize feature names, no user input to model
6. **Data Leakage** → Tenant isolation, audit access control
7. **Insider Modification** → Tamper-evident audit, role separation

**Work:**
- Create THREAT_MODEL.md
- For each threat: description, likelihood, impact, mitigation, residual risk, owner
- Add test for each mitigation
- Quarterly threat review

**Impact:** Security maturity, insurance/compliance

---

### [ ] Task #8: Secrets Management
**Status:** Not started

**Scope:**
- Use managed secret store (AWS Secrets Manager, HashiCorp Vault)
- Rotation procedure
- Environment separation

**Work:**
- Replace `.env.local` with secret store client
- Define secrets: DB_URL, RAZORPAY_KEY, JWT_SECRET, API_KEYS
- Add rotation schedule (30-day default)
- Separate dev/staging/prod secrets
- Add audit logging for secret access
- Block secrets from logs/console/client

**Impact:** Reduces key compromise blast radius

---

### [ ] Task #9: Privacy - Synthetic Data + PII Redaction
**Status:** Not started

**Scope:**
- Prod mode rejects demo-only data paths
- Logs contain no unnecessary PII
- Can run with synthetic data end-to-end

**Work:**
- Add synthetic data generator (fake suppliers, payments)
- Mark demo data (demo: true flag)
- Prod mode: reject demo data on create
- Add PII redaction in logs: mask emails, phone, amounts >threshold
- Create synthetic dataset for testing
- Add smoke test that runs on synthetic data

**Impact:** Privacy (GDPR), testing safety

---

### [ ] Task #10: API Contracts - Full Coverage
**Status:** Partially done (schemas exist, not all routes using)

**Scope:**
- All routes validate input with Zod
- All routes return typed response
- Frontend/backend types match

**Work:**
- Update 12 routes to use schemas (wrap with safeParse)
- Add response type validation
- Generate OpenAPI/Swagger from schemas
- Add TypeScript types to route responses
- Test type consistency between UI + API

**Impact:** No silent API drift, better DX

---

### [ ] Task #11: API Errors - Standardized Codes
**Status:** Partially done (error classes exist, not all routes using)

**Scope:**
- Consistent status codes across all endpoints
- Consistent error codes

**Status Codes:**
- 200 - Success (GET, some POST)
- 201 - Created (resource created)
- 400 - Validation error
- 401 - Unauthenticated
- 403 - Forbidden (authorized but no access)
- 404 - Not found
- 409 - Conflict (state error, idempotency)
- 422 - Policy rejection (business rule)
- 429 - Rate limited
- 500 - Internal error
- 503 - Service unavailable

**Error Codes:**
- VALIDATION_ERROR, NOT_FOUND, UNAUTHORIZED, FORBIDDEN
- CONFLICT, IDEMPOTENCY_CONFLICT, POLICY_REJECTION
- RATE_LIMIT_EXCEEDED, INTERNAL_ERROR, SERVICE_UNAVAILABLE

**Work:**
- Update all routes to use error handler middleware
- Map errors to correct status codes
- Test each error path
- Document status/code matrix

**Impact:** Predictable error responses, better UX

---

### [ ] Task #12: API Idempotency - All Financial Endpoints
**Status:** Infrastructure done, not applied

**Scope:**
- Require Idempotency-Key header on all POST /financial/* endpoints
- Safe retries (no double-charge)

**Endpoints:**
- POST `/api/opportunities/:id/approve`
- POST `/api/payments/:id/approve`
- POST `/api/reconciliation/:id/resolve`
- POST `/api/reconciliation/run`

**Work:**
- Extract and validate header on entry
- Check for duplicate before processing
- Mark as PENDING, execute, mark SUCCESS/FAILED
- Return 409 if replay with different request
- Test concurrent calls with same key
- Document header requirement in OpenAPI

**Impact:** Safe retries, no orphan payments

---

## Phase 2: Performance & Operations (FUTURE)

### [ ] Task #13: Performance - Capacity Assumptions
- Establish SLOs (p50/p95/p99)
- Document expected volumes: suppliers, payments, webhooks/sec
- Tie architecture decisions to capacity

### [ ] Task #14: Performance - Load Testing
- Test against actual deployment shape (serverless, SQLite, etc.)
- Run at 10x expected peak load
- Identify bottlenecks
- Document resource requirements

### [ ] Task #15: UI Security
- Add security headers (CSP, X-Frame-Options, HSTS)
- Secure cookies (Secure, HttpOnly, SameSite)
- CSRF protection
- Safe error rendering (no stack traces to user)

### [ ] Task #16: Accessibility
- Keyboard navigation (Tab, Enter, Arrow)
- Focus states (visible indicators)
- Semantic HTML (headings, labels, landmarks)
- ARIA attributes for dynamic content
- Screen reader testing

### [ ] Task #17-19: Documentation
- Reconcile README vs. actual code
- Add "What is real / simulated / not implemented" table
- Five-minute recovery guide (migration failure, webhook rejection, provider timeout)

---

## Implementation Order (Recommended)

**Week 1 (Security Foundation):**
1. Task #11 - Update all routes with standardized errors
2. Task #2 - Wrap 6 unprotected routes with auth
3. Task #10 - Apply Zod validation to all routes

**Week 2 (Financial Safety):**
4. Task #12 - Add idempotency to approval/reconciliation routes
5. Task #4 - Rate limiting on webhooks + expensive ops
6. Task #7 - Document threat model

**Week 3 (Compliance):**
7. Task #1 - Session auth (if time permits)
8. Task #3 - Tenant isolation (foundational, enables multi-tenant)
9. Task #8 - Secrets management

**Week 4+ (Audit & Operations):**
10. Task #5-6 - Audit hardening
11. Task #9 - Privacy enforcement
12. Task #13-19 - Performance, UX, docs

---

## Testing Strategy

Each task includes:
- **Unit tests**: Business logic and edge cases
- **Integration tests**: Multi-step workflows
- **Security tests**: Unauthorized access, injection, bypass attempts
- **Load tests**: Performance under expected volume
- **Regression tests**: Ensure existing features still work

**Test Coverage Target:** 80% (security paths 100%)

---

## Rollout Strategy

**Phase 0 (Completed):**
- Foundation deployed to dev
- No prod impact

**Phase 1 (Next):**
- Deploy to staging first
- Run full test suite + manual QA
- Shadow traffic comparison (new code path vs. old)
- Gradual rollout to prod (canary: 10% → 50% → 100%)

**Phase 2+:**
- Feature flags for gradual enablement
- Monitoring + alerting on all new paths
- Quick rollback capability

---

## Metrics to Track

- **Security:** Auth failures, authz rejections, idempotency cache hits
- **Reliability:** Error rate by code, 5xx rate, idempotency conflicts
- **Performance:** P50/P95/P99 latency by endpoint, rate limit rejections
- **Compliance:** Audit export requests, retention policy breaches, tamper detections

---

## Sign-Off

- **Security Lead:** [ ] Reviewed threat model + mitigations
- **Ops Lead:** [ ] Reviewed performance + deployment strategy
- **Compliance:** [ ] Reviewed audit + retention procedures
- **Product:** [ ] Reviewed UX impact of auth changes

---

## Related Documents

- [Threat Model](./THREAT_MODEL.md) - Detailed threats and mitigations
- [API Documentation](./API.md) - All endpoints, schemas, error codes
- [Audit Guide](./AUDIT.md) - How to review audit chain
- [Operations Runbook](./RUNBOOK.md) - Recovery procedures
