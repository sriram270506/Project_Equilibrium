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
2. Route Handler — withAuth guard (role check), Zod validation
   ↓
3. Risk controls — kill switch, daily exposure, per-transaction cap,
   per-supplier limit. Checked BEFORE any write.
   ↓
4. Maker-checker — above the dual-approval threshold the payment is created
   in PENDING_APPROVAL and a second, different operator must confirm.
   ↓
5. Domain Service (business logic, state transitions)
   ↓
6. Prisma Transaction (atomically create/update entities)
   ├─ Create/update primary entity
   ├─ Create ledger entries (balanced)
   ├─ Create audit event
   └─ Create outbox event (eventual publishing)
   ↓
7. Provider Integration (call external service)
   ├─ Idempotency check (fingerprint + key)
   ├─ Submit operation
   └─ Update internal state based on result
   ↓
8. Return Response (200, 201, 400, 401, 403, 409, 500)
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
PENDING_APPROVAL (only above the dual-approval threshold)
    ↓
INTENT_CREATED
    ↓
    ├─→ SUBMITTED (written BEFORE the provider call, so a crash mid-call
    │              leaves a payment reconciliation actively sweeps rather
    │              than an invisible orphan)
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

**The model is fitted, not hand-written.** `scripts/train-model.ts`
(`npm run ml:train`) generates synthetic supplier cash flows, simulates seven
days forward to derive a ground-truth label, fits a logistic regression by
gradient descent on a 75/25 split, and writes
`src/lib/ml/model-artifact.generated.json`. The application loads that file, so
the coefficients it scores with are exactly the ones that were evaluated.

An earlier hand-specified version of this model had a feature and its
coefficient double-negated, so more cash runway predicted *more* distress and
every supplier scored 99%. Fitting removes that whole class of error: a training
loop cannot learn a sign that contradicts its own data.

**Features** (`src/lib/ml/features.ts`, shared by training and serving so the
two cannot drift apart — all normalised to roughly [0, 1]):

| Feature | Meaning | Fitted weight |
|---|---|---|
| `cashFlowVolatility` | How much daily cash swings | +0.158 |
| `runwayPressure` | 1 at zero cash, 0 at 14 days of cover | +3.633 |
| `paymentIrregularity` | How unreliably their customers pay | +3.022 |
| `balanceCoverage` | Cash against a week of outflow | −4.551 |
| `tenureYears` | Relationship length over five years | +0.066 |

**Held-out performance**: AUC 0.940 (baseline `runway < 7d`: 0.924), recall 97%,
precision 44% (baseline 31%).

**Threshold selection.** The action threshold is 0.15, not 0.50. The two errors
are not symmetric — a false positive offers cheap capital to someone who did not
strictly need it, a false negative means a supplier misses payroll. The
threshold is chosen by sweeping candidates and maximising a recall-weighted
F-score (β = 3) on the training split, subject to a precision floor. At 0.50
this model recalls 15% of distressed suppliers.

`DEFAULT_POLICY_CONSTRAINTS.minModelProbability` reads that same threshold from
the artifact, so policy and model cannot disagree about what counts as at-risk.

**Explainability** (`src/lib/ml/explain.ts`): because a logistic regression is
additive in log-odds, `explainPrediction` decomposes any prediction into exact
per-feature contributions that sum to the logit — no SHAP sampling, no surrogate
model. It also sweeps runway to produce a counterfactual: what would have to be
different for the decision to flip.

**Provenance**: every opportunity stores `featureSnapshotJson` and
`modelVersion`, and the offer detail page recomputes its explanation from the
*stored* snapshot — so reopening a decision months later shows why it was made
then, not what would be decided today.

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

### 11. Authentication and Authorisation

`src/lib/auth/guard.ts`. Every mutating route is wrapped in `withAuth(role,
handler)`, which resolves the caller from an API key (`Authorization: Bearer` or
`X-API-Key`) and refuses the request if their role is insufficient.

**Identity comes from the credential, never from the payload.** The approving
operator used to be read from the request body, which meant the audit trail
recorded whatever the caller claimed — worse than no audit trail, because it
looks trustworthy.

Roles are ordered: `VIEWER` < `OPERATOR` < `APPROVER` < `ADMIN`.

| Route | Requires |
|---|---|
| `POST /api/opportunities/:id/approve` | OPERATOR |
| `POST /api/payments/:id/approve` (checker) | APPROVER |
| `POST /api/demo/inject` | OPERATOR |
| `PATCH /api/risk` | ADMIN |
| `POST /api/audit` (tamper test) | ADMIN |

In demo mode an unauthenticated request is accepted as the seeded operator so
the walkthrough works from a browser without key management. That fallback is
disabled outside demo mode — a convenience that silently survives into
production is a vulnerability, so it fails closed.

### 12. Risk Controls

`src/lib/risk/controls.ts`. The limits that hold regardless of what the model
believes, checked before any write:

| Control | Default | Purpose |
|---|---|---|
| Kill switch | off | Halts every outbound payment immediately |
| Daily exposure | ₹10,00,000 | Total advanced across all suppliers in a day |
| Per-transaction cap | ₹1,50,000 | Largest single advance |
| Per-supplier limit | ₹3,00,000 | Most outstanding to one counterparty |
| Dual-approval threshold | ₹75,000 | Above this, a second approver is required |

They live in a database row rather than in code because the moment you need a
kill switch is never the moment you can wait for a deploy. Every change writes
an audit entry naming who made it.

**Today's exposure counts `UNKNOWN` payments.** A payment we cannot classify may
well have moved money, and a limit that ignored it could be breached invisibly
by a run of timeouts.

**Maker-checker**: advances at or above the threshold are created in
`PENDING_APPROVAL`. `confirmSecondApproval` refuses if the checker is the same
person as the maker, and re-checks the limits before releasing — time has passed
and today's exposure may have moved. The refusal is in the service, not the UI,
because a control that only exists in the interface is not a control.

### 13. Tamper-Evident Audit Log

`src/lib/audit.ts`. "Immutable" is a promise most systems make and none can
prove: rows can always be updated by whoever holds the credentials. Instead,
tampering is made *detectable*.

```
entryHash = SHA256(
  sequence ‖ eventType ‖ actorType ‖ actorId ‖ aggregateType ‖
  aggregateId ‖ payloadJson ‖ correlationId ‖ createdAt ‖ previousHash
)
```

Each entry chains to its predecessor, so:

- editing a historical row → its hash no longer matches → `CONTENT_ALTERED`
- pointing at the wrong predecessor → `CHAIN_BROKEN`
- deleting a row → gap in the global sequence → `SEQUENCE_GAP`

`verifyAuditChain()` walks the whole log and reports the first break with its
sequence number and reason. `POST /api/audit` (demo mode, ADMIN) deliberately
corrupts an entry so the property can be demonstrated rather than asserted.

**What this does not prove**: a determined attacker with write access could
recompute the entire chain. What it makes impossible is a *silent* edit, which
in practice is the difference between an audit log and a table of hopes.

Audit entries are written through `createAuditEvent(input, tx)` and pass the
transaction client so they commit with the change they describe. Writing to
`prisma.auditEvent` directly would leave an entry with no valid hash — the type
system now rejects that, since `sequence`, `previousHash` and `entryHash` are
required columns.

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
- No `any` types in the money path (`src/lib/money.ts`, ledger, policy)
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

1. **Database**: Replace SQLite with Postgres and adopt a migration history
   (currently `prisma db push`, no `prisma/migrations/`)
2. **Event Transport**: Replace local event table with Redis Streams
3. **Provider**: Replace MockRazorpay with live Razorpay adapter
4. **Webhooks**: Done — `POST /api/webhooks/razorpay` verifies HMAC-SHA256
   with a timing-safe comparison and deduplicates on the provider event id.
   Remaining: the signature check accepts all requests when the secret is
   unset, which is fine for the demo but must fail closed in production.
5. **Secrets**: Use AWS Secrets Manager or HashiCorp Vault
6. **Background Workers**: The outbox publisher exists and is wired to
   `POST /api/internal/events/publish`; it still needs to run as a scheduled
   worker rather than being triggered by a request.
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
