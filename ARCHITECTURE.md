# Equilibrium — Architecture Document

## System Design Principles

### 1. Single Source of Truth

Three systems maintain separate truth boundaries:

| System | Authority | Responsibility |
|--------|-----------|-----------------|
| **Provider** (MockRazorpay) | Live payment state | Has occurred externally |
| **Database** (Prisma/SQLite) | Business logic state | What we know internally |
| **Event Log** | Transport mechanism | Replay and audit trail |

**Golden Rule**: Never let the event log authoritative over the database or provider. The log is a communication channel, not a source of truth.

### 2. Request Lifecycle

```
1. Client Request
   ↓
2. Route Handler (validate input, auth check)
   ↓
3. Domain Service (business logic, state transitions)
   ↓
4. Prisma Transaction (atomically create/update entities)
   ├─ Create/update primary entity
   ├─ Create ledger entries (balanced)
   ├─ Create audit event
   └─ Create outbox event (eventual publishing)
   ↓
5. Provider Integration (call external service)
   ├─ Idempotency check (fingerprint + key)
   ├─ Submit operation
   └─ Update internal state based on result
   ↓
6. Return Response (200, 201, 400, 409, 422, 500)
```

### 3. Provider Adapter Pattern

```typescript
interface PaymentProvider {
  createOperation(input: CreateOperationInput): Promise<ProviderOperationResult>;
  getOperation(providerReference: string): Promise<ProviderOperationResult | null>;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  getProviderName(): string;
  simulateWebhook?(providerPaymentId: string): Promise<WebhookPayload | null>;
}
```

**Implementation Strategy**:
- All provider calls happen server-side
- Provider secrets never leak to client
- MockRazorpay provides deterministic testing
- Real Razorpay adapter can replace mock without changing business logic

### 4. Financial State Machine

#### PaymentIntent Lifecycle

```
INTENT_CREATED
    ↓
    ├─→ SUBMITTED (sent to provider)
    │     ├─→ ACKNOWLEDGED (provider accepted)
    │     │     ├─→ CONFIRMED (executed successfully)
    │     │     │     └─→ [TERMINAL]
    │     │     ├─→ UNKNOWN (result indeterminate)
    │     │     │     └─→ [Reconciliation resolves to CONFIRMED or FAILED]
    │     │     ├─→ FAILED (provider declined)
    │     │     │     └─→ [TERMINAL - may reverse]
    │     │     └─→ MANUAL_REVIEW (requires operator intervention)
    │     │           └─→ [TERMINAL]
    │     ├─→ REVERSED (undone after confirmation)
    │     └─→ [TERMINAL]
    └─→ [TERMINAL states]
```

**Key Properties**:
- `UNKNOWN` is non-terminal (requires reconciliation)
- Once `CONFIRMED`, immutable (can reverse but creates new record)
- `FAILED` is terminal (no automatic retry)
- Every status transition is server-validated

#### LiquidityOpportunity Lifecycle

```
RECOMMENDED (policy approved, awaiting operator action)
    ├─→ APPROVED (operator approved, payment created)
    │     └─→ EXECUTED (payment confirmed)
    └─→ REJECTED (operator or policy declined)
```

#### DisputeCase Lifecycle

```
OPEN (newly received from provider)
    ├─→ DRAFT_READY (complete evidence, auto-validation passed)
    │     └─→ SUBMITTED (evidence draft sent to provider)
    ├─→ NEEDS_REVIEW (contradictory or incomplete evidence)
    │     └─→ [Manual operator resolution]
    └─→ CLOSED (resolved or expired)
```

### 5. Accounting Model

Every financial operation creates balanced ledger entries:

```
Discount Payout Example:

  Debit:  PLATFORM_CASH           ₹1,500.00
  Credit: SUPPLIER_PAYABLE        ₹1,500.00
  
  Recorded in: LedgerTransaction + 2× LedgerEntry
  Immutable: Once created, never updated
  Correction: Creates new reversal transaction
```

**Account Codes** (extensible):
- `PLATFORM_CASH`: Company liquidity
- `SUPPLIER_PAYABLE`: Supplier liability
- `DISCOUNT_EXPENSE`: Cost of capital operations
- `PROVIDER_CLEARING`: Provider settlement account
- `ESCROW_LIABILITY`: Held funds (not implemented)
- `REFUND_RESERVE`: Contingency reserve

**Ledger Invariant**: 
```
Σ(debits) ≡ Σ(credits) [Always verified in code, never in SQL]
```

### 6. Idempotency Model

**Request Fingerprinting**:
```typescript
const requestPayload = {
  supplier_id: "...",
  amount_paise: 150000,
  discount_bps: 120,
  operation_type: "DISCOUNT_PAYOUT"
};

const fingerprint = SHA256(JSON.stringify(sortedKeys(payload)));
```

**Idempotency Key**:
- Generated server-side: `idem_<uuid>`
- Or provided by client
- Must be unique per request-fingerprint pair
- Reusing key with different payload → 409 Conflict

**Duplicate Webhook Handling**:
```
webhook.eventId or webhook.idempotencyKey
  ↓
EventRecord.idempotencyKey check
  ↓
If exists: skip (already processed)
If new: process once, write EventRecord
```

### 7. Correlation ID Propagation

Every financial operation flows with a correlation ID:

```
Client Request
  ↓ (or generated server-side)
  ├─ HTTP header: X-Correlation-ID
  ├ PassedTo ─→ Route Handler
              ├─ Domain Service
              ├─ Prisma (stored in events + audit)
              ├─ Provider adapter (external call reference)
              └─ Response envelope
```

**Usage**: Trace a ₹1,500 payment through:
- User approval event
- Internal ledger creation
- Provider submission
- Webhook callback
- Reconciliation case

All linked by single `correlationId`.

### 8. ML Model Integration

**Model Artifact** (`src/lib/ml/model-artifact.ts`):
```typescript
{
  modelVersion: "liquidity-logistic-v1-demo",
  features: ["cashFlowVolatility", "daysRunwayTrend", ...],
  coefficients: {...},
  intercept: 0.5,
  calibrationNote: "Demo model. Not production trained."
}
```

**Logistic Evaluation**:
```
logit = intercept + Σ(coefficient × feature)
probability = sigmoid(logit) = 1 / (1 + e^-logit)
```

**Versioning**:
- Every opportunity stores `modelVersion` and `featureSnapshotJson`
- Allows backtracking: "Why was this opportunity recommended?"
- Supports model drift detection

**Policy Integration**:
```
Model probability → Economic policy evaluation
  ├─ Hard caps applied (regardless of model confidence)
  ├─ Expected value calculated
  ├─ Policy decision: APPROVE or REJECT
  └─ Reason documented (for audit)
```

### 9. Reconciliation Flow

**Trigger**: `POST /api/reconciliation/run`

**For each PaymentIntent**:
1. Get internal payment record
2. Query provider for same payment (via `providerPaymentId`)
3. Compare fields:
   - Amount match?
   - Status alignment?
   - Status transition valid?
4. Outcomes:
   - `MATCHED`: Update internal if needed, mark resolved
   - `AMOUNT_MISMATCH`: Create case, flag CRITICAL
   - `STATUS_MISMATCH`: Create case, flag WARNING
   - `MISSING_EXTERNAL`: Create case, flag CRITICAL
   - `MISSING_INTERNAL`: Create case, flag CRITICAL (orphaned payment)
5. Store ReconciliationCase (never overwrites internal state blindly)

**Example**:
```
Internal: UNKNOWN (timeout)
Provider: CONFIRMED

Action: Update internal to CONFIRMED (align with truth)
Reconcile Case: MATCHED (issue resolved)
```

### 10. Event Sourcing & Outbox

**Outbox Pattern** (for eventual consistency):

```
1. Client Request
   ↓
2. Prisma Transaction:
   ├─ Create PaymentIntent
   ├─ Create LedgerTransaction
   ├─ Create AuditEvent
   └─ Create OutboxEvent (status: PENDING)
   ↓
3. Commit ✓ (all-or-nothing)
   ↓
4. (Later) Publish Pending Events:
   ├─ SELECT * FROM OutboxEvent WHERE status = PENDING
   ├─ Append to EventRecord (per aggregate sequence)
   ├─ Update OutboxEvent.status = PUBLISHED
   ├─ On failure: exponential backoff, max 3 attempts
   └─ Move to FAILED if exhausted
```

**EventRecord Structure**:
```typescript
{
  id: "evt_...",
  eventType: "PAYMENT_INTENT_CREATED",
  aggregateType: "PAYMENT_INTENT",
  aggregateId: "pay_...",
  sequenceNumber: 1,  // Per aggregate, not global
  schemaVersion: "1.0",
  payloadJson: {...},
  idempotencyKey: "pay_..._1",  // Prevents double-replay
  correlationId: "corr_...",
  createdAt: "2024-08-30T..."
}
```

**Replay Safety**: Sequence numbers + idempotency keys prevent replaying same event.

## Type Safety & Validation

### Zod Schemas

All request/response shapes validated at route boundaries:

```typescript
// Input validation
const approveSchema = z.object({
  opportunityId: z.string().uuid(),
  correlationId: z.string().optional(),
});

// Route handler
export async function POST(request: NextRequest) {
  const body = await request.json();
  const validated = approveSchema.parse(body);  // Throws 400 if invalid
  
  // Safe to use validated.*
}
```

### TypeScript Strict Mode

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Benefits:
- No `any` types in financial code
- Null coalescing required
- Exhaustive switch statements

## Performance Considerations

### Database Queries

```typescript
// ✓ Good: Selective fields, indexed queries
await prisma.liquidityOpportunity.findMany({
  where: { status: "RECOMMENDED" },
  select: { id, supplierId, expectedValuePaise },
  orderBy: { createdAt: "desc" },
  take: 50
});

// ✗ Avoid: N+1 queries
const opportunities = await prisma.liquidityOpportunity.findMany();
for (const opp of opportunities) {
  const supplier = await prisma.supplier.findUnique(...); // ← Called 50x!
}
```

### Indexes

Schema includes indexes on:
- `LiquidityObservation(supplierId, observedAt)`
- `LiquidityOpportunity(status, supplierId)`
- `PaymentIntent(status, supplierId, correlationId)`
- `OutboxEvent(status, availableAt)`

### Caching Strategy

- Immutable: Supplier list, model artifact
- Short-lived: Dashboard KPIs (recalculated per request in demo)
- No client-side caching: Financial state always fresh

## Deployment Considerations

### For Production

1. **Database**: Replace SQLite with Postgres
2. **Event Transport**: Replace local event table with Redis Streams
3. **Provider**: Replace MockRazorpay with live Razorpay adapter
4. **Webhooks**: Implement real webhook receiver + signature verification
5. **Secrets**: Use AWS Secrets Manager or HashiCorp Vault
6. **Background Workers**: Deploy outbox publisher as separate service
7. **Observability**: Add DataDog/Honeycomb tracing
8. **Compliance**: Formal security audit, PCI-DSS certification

### Zero-External-Key Demo

Default mode requires zero setup:
- ✓ SQLite included
- ✓ MockRazorpay self-contained
- ✓ No provider credentials needed
- ✓ Synthetic data only
- ✓ Runs on laptop

### Environment Variables

```bash
# Demo mode (default)
APP_MODE=demo
RAZORPAY_MODE=mock

# Production mode (when ready)
APP_MODE=production
RAZORPAY_MODE=live
RAZORPAY_KEY_ID=<real key>
RAZORPAY_KEY_SECRET=<real secret>
DATABASE_URL=postgres://...
REDIS_URL=redis://...
```

---

**Last Updated**: August 2026  
**Status**: Buildathon Prototype  
**Compliance**: Demo Only
