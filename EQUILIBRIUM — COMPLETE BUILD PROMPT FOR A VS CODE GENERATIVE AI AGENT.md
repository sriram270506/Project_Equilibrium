# EQUILIBRIUM — COMPLETE BUILD PROMPT FOR A VS CODE GENERATIVE AI AGENT

## How to use this file

Copy everything from the next heading into VS Code’s Generative AI Agent. The agent must treat this document as the authoritative specification. It must not invent additional modules, change the architecture, add unnecessary infrastructure, or claim a feature is complete without implementing and testing it.

---

# MASTER INSTRUCTION TO THE VS CODE AGENT

You are the lead full-stack engineer responsible for building **Equilibrium**, a polished Razorpay Buildathon prototype from an empty workspace to a runnable application with a browser GUI.

You must build the project completely, verify it locally, fix all errors, and leave the workspace in a state where a non-expert can start it with one documented command and open the GUI in a browser.

The application must be a **focused, demo-ready fintech operations control layer**, not a production-certified payments platform. The primary hero workflow is:

> A marketplace finance operator reviews an ML-assisted early-payment opportunity, sees the expected economic value and hard safety limits, approves it, and observes a payment-provider workflow that remains financially correct even when a webhook is duplicated or a provider request times out.

The secondary workflow is a small dispute-evidence screen that demonstrates one thing only: the system creates a cited draft from structured evidence and refuses or escalates when evidence is missing or contradictory.

The escrow module, full Account Aggregator integration, live automated dispute submission, multi-currency support, and production compliance certification are **not** to be implemented. They must appear in an explicit “Designed but not implemented / Out of scope” section in the UI and README.

## Non-negotiable architecture decision: use one full-stack application

To avoid frontend/backend/API connectivity failures, build this as a **single Next.js TypeScript application** with server-side API route handlers. Do not create a separate frontend server and backend server. Do not create a separate Python ML service. Do not require Docker, Redis, Kafka, Postgres, or cloud infrastructure for the default demo.

Use the following stack unless a dependency is genuinely incompatible:

| Layer | Required choice |
|---|---|
| Application | Next.js with App Router and TypeScript |
| Styling | Tailwind CSS |
| UI components | Accessible reusable components; shadcn/ui may be used if it installs cleanly, otherwise create local components |
| Database | Prisma with SQLite for local/demo mode |
| Validation | Zod schemas shared by UI and API code |
| Testing | Vitest for unit/integration tests and Playwright for browser smoke tests |
| Charts | Recharts or another lightweight client-side chart library |
| Icons | Lucide React or another stable icon package |
| IDs | UUIDs or CUIDs generated server-side |
| Money | Integer minor units only; Indian rupees are represented as paise |
| ML | Deterministic TypeScript inference using a persisted model artifact; no runtime Python service |
| Provider integration | Server-side provider adapter with MockRazorpay as the default and optional Razorpay test-mode adapter |
| Authentication | Demo operator identity only; no real user authentication or live customer data |

The application must run in demo mode with **zero external API keys**. Never make the GUI depend on a Razorpay key, Account Aggregator credential, LLM key, Redis instance, or cloud database in order to start.

## Connectivity rules that must not be violated

1. The browser must call only same-origin relative URLs such as `/api/dashboard`, `/api/opportunities`, and `/api/demo/reset`. Never hard-code `localhost:3000`, `localhost:8000`, a LAN IP, or a production URL inside frontend code.
2. All external/provider calls must happen on the server. Never expose secret keys in client components, browser bundles, `NEXT_PUBLIC_` variables, or API responses.
3. Define request and response schemas once with Zod and use them in both route handlers and client fetch helpers. Do not duplicate DTO definitions manually.
4. Create one typed API client at `src/lib/api-client.ts`. All client-side network calls must go through it. Do not scatter raw `fetch()` calls across components.
5. Every route must return a consistent JSON envelope: `{ success: true, data }` for success and `{ success: false, error: { code, message, details? } }` for failure.
6. Every API route must validate input before doing any database or provider work.
7. Every mutation must return the updated resource or a useful operation result, never an empty response that forces the UI to guess.
8. The UI must show loading, success, empty, and error states for every network operation.
9. Use a single Prisma client instance in development to avoid hot-reload connection problems.
10. Run Prisma migrations and seed data automatically through documented scripts. The application must fail with a clear setup message if the database is missing.
11. Do not use CORS because frontend and backend are same-origin. Do not add a proxy unless Next.js requires one.
12. Do not call the database directly from client components. All database access belongs in server code.
13. Do not use optimistic updates for financial state. Refresh or revalidate from the server after every mutation.
14. Disable mutation buttons while requests are in progress and use server-side idempotency regardless of UI behavior.
15. Never use floating-point arithmetic for amounts, discounts, fees, or balances.

## Product identity and visual direction

Product name: **Equilibrium**.

Subtitle: **Bounded intelligence for safer payment operations**.

The visual design should feel like a serious fintech operations console: clean white and slate surfaces, deep navy text, restrained emerald for safe/positive states, amber for pending/review states, and red only for risk/failure. Use Indian rupee formatting such as `₹1,25,000.00`.

The primary dashboard must look polished on a laptop and remain usable on a tablet. It must have a persistent sidebar or top navigation with:

- Overview
- Liquidity Opportunities
- Payment Operations
- Dispute Evidence
- Reconciliation
- Demo Controls
- Scope & Controls

The UI must not look like an unstyled admin template. Use consistent spacing, typography, badges, cards, tables, modals, confirmation dialogs, tooltips, and a visible “Demo Mode” banner.

## Core product narrative

The system has three truth boundaries:

| System | Authority |
|---|---|
| Razorpay or MockRazorpay | Authoritative external payment-provider financial state |
| Postgres in production / Prisma SQLite in demo | Authoritative internal business and accounting state |
| Redis Streams conceptually / local event records in demo | Transport and replay mechanism, never financial authority |

Because the default application must be easy to run, implement the transport layer with a durable local `EventRecord` table. Design the interfaces so a future Redis Streams adapter can replace it. Do not force the user to install Redis for this buildathon prototype.

---

# 1. REQUIRED PROJECT STRUCTURE

Create the following structure, adapting only when Next.js conventions require it:

```text
/equilibrium
  /app
    /(dashboard)
      /layout.tsx
      /page.tsx
      /opportunities/page.tsx
      /payments/page.tsx
      /disputes/page.tsx
      /reconciliation/page.tsx
      /demo/page.tsx
      /scope/page.tsx
    /api
      /dashboard/route.ts
      /opportunities/route.ts
      /opportunities/[id]/approve/route.ts
      /payments/route.ts
      /payments/[id]/route.ts
      /webhooks/razorpay/route.ts
      /reconciliation/route.ts
      /reconciliation/run/route.ts
      /disputes/[id]/route.ts
      /disputes/[id]/draft/route.ts
      /demo/reset/route.ts
      /demo/scenario/route.ts
      /health/route.ts
    /globals.css
    /layout.tsx
  /components
    /layout
    /dashboard
    /opportunities
    /payments
    /disputes
    /reconciliation
    /demo
    /ui
  /src
    /lib
      api-client.ts
      api-envelope.ts
      env.ts
      prisma.ts
      money.ts
      ids.ts
      dates.ts
      errors.ts
      audit.ts
      correlation.ts
      idempotency.ts
      economic-policy.ts
      ml
        model-artifact.ts
        liquidity-model.ts
        evaluation.ts
      payments
        provider-types.ts
        mock-razorpay.ts
        razorpay-adapter.ts
        payment-service.ts
      events
        event-types.ts
        event-service.ts
      disputes
        evidence-service.ts
        draft-service.ts
      reconciliation
        reconciliation-service.ts
    /schemas
      api.ts
      opportunity.ts
      payment.ts
      dispute.ts
      reconciliation.ts
    /server
      dashboard-service.ts
      opportunity-service.ts
      demo-service.ts
  /prisma
    schema.prisma
    seed.ts
  /tests
    /unit
    /integration
    /e2e
  /public
  /.env.example
  /README.md
  /DEMO_SCRIPT.md
  /ARCHITECTURE.md
  /SECURITY_SCOPE.md
  /package.json
  /tsconfig.json
```

If the framework version uses a different location for source files, preserve the logical separation and update imports consistently. Do not create duplicate versions of the same service.

---

# 2. ENVIRONMENT AND STARTUP REQUIREMENTS

Create `.env.example` with safe placeholders:

```env
DATABASE_URL="file:./dev.db"
APP_MODE="demo"
RAZORPAY_MODE="mock"
RAZORPAY_KEY_ID=""
RAZORPAY_KEY_SECRET=""
RAZORPAY_WEBHOOK_SECRET=""
DEMO_OPERATOR_ID="demo-finance-operator"
NEXT_PUBLIC_APP_NAME="Equilibrium"
```

Never commit `.env`, database files, secrets, or provider credentials.

Add these scripts:

```json
{
  "dev": "prisma generate && prisma migrate deploy && prisma db seed && next dev",
  "build": "prisma generate && prisma migrate deploy && next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:seed": "tsx prisma/seed.ts",
  "db:reset": "prisma migrate reset --force",
  "demo:verify": "tsx scripts/verify-demo.ts"
}
```

If `prisma migrate deploy` cannot run before migrations exist, create the initial migration during setup and make the scripts robust. The README must include:

```bash
cp .env.example .env
npm install
npm run dev
```

The GUI must be available at `http://localhost:3000`.

Create `/api/health`. It must verify application availability and database connectivity and return the current mode. The dashboard must display a small system-status indicator using this endpoint.

---

# 3. DATABASE MODEL

Implement the following Prisma models. Add indexes and unique constraints wherever specified. Use integer amounts in paise.

## Supplier

- `id: String @id`
- `name: String`
- `email: String`
- `riskTier: String`
- `createdAt: DateTime`
- relation to liquidity observations, opportunities, payments, and audit events

## LiquidityObservation

- `id: String @id`
- `supplierId: String`
- `observedAt: DateTime`
- `availableBalancePaise: Int`
- `inflowPaise: Int`
- `outflowPaise: Int`
- `daysRunway: Float`
- `paymentRegularity: Float`
- `volatility: Float`
- `source: String` with values `DEMO_SYNTHETIC` or `AA_SANDBOX`
- index on `(supplierId, observedAt)`

## LiquidityOpportunity

- `id: String @id`
- `supplierId: String`
- `predictionProbability: Float`
- `modelVersion: String`
- `featureSnapshotJson: String`
- `policyVersion: String`
- `expectedBenefitPaise: Int`
- `opportunityCostPaise: Int`
- `riskCostPaise: Int`
- `expectedValuePaise: Int`
- `recommendedDiscountBps: Int`
- `maxAllowedDiscountPaise: Int`
- `status: String`: `RECOMMENDED`, `APPROVED`, `REJECTED`, `EXECUTED`, `EXPIRED`
- `decisionReason: String`
- `createdAt: DateTime`
- `updatedAt: DateTime`
- index on status and supplier

## PaymentIntent

- `id: String @id`
- `internalReference: String @unique`
- `provider: String` default `RAZORPAY`
- `providerPaymentId: String?`
- `providerOrderId: String?`
- `operationType: String`: `DISCOUNT_PAYOUT`, `ESCROW_HOLD`, `ESCROW_RELEASE`, `REFUND`
- `amountPaise: Int`
- `currency: String` default `INR`
- `status: String`: `INTENT_CREATED`, `SUBMITTED`, `ACKNOWLEDGED`, `UNKNOWN`, `CONFIRMED`, `FAILED`, `REVERSED`, `MANUAL_REVIEW`
- `requestFingerprint: String`
- `providerIdempotencyKey: String @unique`
- `correlationId: String`
- `failureMode: String?`
- `createdAt`, `updatedAt`, `confirmedAt`
- unique constraint on providerPaymentId when available if supported; otherwise enforce in service transaction

## LedgerTransaction

- `id: String @id`
- `referenceType: String`
- `referenceId: String`
- `currency: String`
- `description: String`
- `createdAt: DateTime`
- relation to ledger entries

## LedgerEntry

- `id: String @id`
- `transactionId: String`
- `accountCode: String`
- `debitPaise: Int`
- `creditPaise: Int`
- `createdAt: DateTime`

Each ledger transaction must balance: total debits equal total credits. Enforce this in application service code and tests. Never update an existing ledger entry. Corrections use reversal transactions.

## OutboxEvent

- `id: String @id`
- `eventType: String`
- `aggregateType: String`
- `aggregateId: String`
- `payloadJson: String`
- `status: String`: `PENDING`, `PUBLISHED`, `FAILED`
- `attemptCount: Int`
- `availableAt: DateTime`
- `lastError: String?`
- `correlationId: String`
- `createdAt`, `publishedAt`
- index on status and availableAt

## EventRecord

- `id: String @id`
- `eventType: String`
- `aggregateType: String`
- `aggregateId: String`
- `sequenceNumber: Int`
- `schemaVersion: String`
- `payloadJson: String`
- `source: String`
- `idempotencyKey: String @unique`
- `correlationId: String`
- `createdAt: DateTime`

Use event sequence numbers per aggregate, not global sequence numbers. Protect sequence allocation in a transaction.

## AuditEvent

- `id: String @id`
- `eventType: String`
- `actorType: String`: `SYSTEM`, `OPERATOR`, `PROVIDER`, `MODEL`
- `actorId: String`
- `aggregateType: String`
- `aggregateId: String`
- `payloadJson: String`
- `modelVersion: String?`
- `policyVersion: String?`
- `correlationId: String`
- `createdAt: DateTime`

Audit events are append-only. Do not log provider secrets, full payment credentials, or unnecessary sensitive data.

## DisputeCase

- `id: String @id`
- `providerDisputeId: String`
- `paymentIntentId: String?`
- `reasonCode: String`
- `amountPaise: Int`
- `status: String`: `OPEN`, `DRAFT_READY`, `NEEDS_REVIEW`, `SUBMITTED`, `CLOSED`
- `createdAt`, `updatedAt`

## EvidenceDocument

- `id: String @id`
- `disputeCaseId: String`
- `documentType: String`
- `title: String`
- `content: String`
- `trustedSource: Boolean`
- `createdAt`

## EvidenceClaim

- `id: String @id`
- `disputeCaseId: String`
- `claimText: String`
- `normalizedField: String`
- `normalizedValue: String`
- `confidence: Float`
- `sourceDocumentId: String`
- `sourceSpan: String`
- `isContradiction: Boolean`
- `createdAt`

## DisputeDraft

- `id: String @id`
- `disputeCaseId: String`
- `draftText: String`
- `claimIdsJson: String`
- `validationStatus: String`: `PASSED`, `FAILED`, `NEEDS_REVIEW`
- `validationErrorsJson: String`
- `createdBy: String`
- `createdAt`

## ReconciliationCase

- `id: String @id`
- `paymentIntentId: String?`
- `providerReference: String?`
- `outcome: String`: `MATCHED`, `MISSING_INTERNAL`, `MISSING_EXTERNAL`, `AMOUNT_MISMATCH`, `STATUS_MISMATCH`, `DUPLICATE`
- `severity: String`: `INFO`, `WARNING`, `CRITICAL`
- `status: String`: `OPEN`, `INVESTIGATING`, `RESOLVED`, `FROZEN`
- `internalAmountPaise: Int?`
- `externalAmountPaise: Int?`
- `notes: String?`
- `correlationId: String`
- `createdAt`, `resolvedAt`

## DemoScenario

- `id: String @id`
- `name: String`
- `description: String`
- `status: String`
- `createdAt: DateTime`

---

# 4. MONEY AND ACCOUNTING RULES

Create `src/lib/money.ts` with:

- `formatPaise(paise: number): string`
- `rupeesToPaise(value: string | number): number`
- `assertValidPaise(value: number): void`
- `addPaise(a, b)`, `subtractPaise(a, b)`, and `percentageOfPaise(amount, bps)`

Reject negative or non-integer paise where not explicitly allowed. Use `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` only for display after integer calculations are complete.

For a discount payout, create a balanced journal. Use clear demo account codes:

- `PLATFORM_CASH`
- `SUPPLIER_PAYABLE`
- `DISCOUNT_EXPENSE`
- `PROVIDER_CLEARING`
- `ESCROW_LIABILITY`
- `REFUND_RESERVE`

The exact accounting mapping must be documented in `ARCHITECTURE.md`. Every financial state change must have a corresponding audit event and, where relevant, ledger transaction.

---

# 5. PAYMENT PROVIDER ADAPTER

Create a provider interface:

```ts
interface PaymentProvider {
  createOperation(input: CreateOperationInput): Promise<ProviderOperationResult>;
  getOperation(providerReference: string): Promise<ProviderOperationResult>;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  getProviderName(): string;
}
```

The provider lifecycle is:

```text
INTENT_CREATED
  -> SUBMITTED
  -> ACKNOWLEDGED
  -> CONFIRMED

SUBMITTED -> UNKNOWN
UNKNOWN -> CONFIRMED | FAILED | REVERSED | MANUAL_REVIEW
SUBMITTED -> FAILED
CONFIRMED -> REVERSED
```

Rules:

1. `UNKNOWN` means the remote result cannot be determined. It is not failure.
2. Never automatically create a second financial operation after `UNKNOWN` unless the provider idempotency key and same request fingerprint are reused.
3. Reusing the same idempotency key with a different amount, currency, operation type, or recipient must produce a conflict error.
4. Store the request fingerprint as a deterministic hash of the canonical request payload.
5. The adapter must be server-only.
6. The mock adapter must support deterministic failure modes: success, timeout-after-remote-success, timeout-before-remote-processing, provider-decline, duplicate-webhook, delayed-webhook, and malformed-webhook.
7. The mock provider must maintain its own simulated external state, separate from internal Prisma state, so reconciliation can detect mismatches.
8. The UI must show provider name, provider reference, idempotency key in masked form, lifecycle status, and correlation ID.
9. The real Razorpay adapter may be implemented behind a feature flag, but the default demo must never require credentials.
10. If implementing a Razorpay webhook route, verify the signature server-side when a secret is configured. In mock mode, accept only locally generated demo signatures or an explicit demo flag.

Implement `MockRazorpay` as a deterministic in-memory or persisted simulator. Prefer persisted simulated provider records in a `MockProviderRecord` table if needed so state survives route reloads.

The provider API should use a Razorpay-like vocabulary and show realistic IDs such as `pay_demo_...`, but clearly label them as simulated in the UI. Do not claim that a mock transaction is a live Razorpay transaction.

---

# 6. HERO WORKFLOW: LIQUIDITY TO SAFE DISCOUNT PAYOUT

## Business scenario

The user is a marketplace finance operator. Suppliers have invoices or payable amounts. Equilibrium estimates whether a supplier is likely to need liquidity soon, computes whether early payment creates positive expected economic value, enforces a policy cap, and offers the operator a controlled approval path.

## Liquidity model

Implement a deterministic model artifact at `src/lib/ml/model-artifact.ts`. It must include:

- `modelVersion`, for example `liquidity-logistic-v1-demo`
- feature names
- coefficients or deterministic scoring weights
- training window description
- label definition
- calibration note
- fallback behavior

Use the following features:

- `cashFlowVolatility`
- `daysRunwayTrend`
- `paymentTimingRegularity`
- `availableBalanceRatio`
- `supplierTenureDays`

Implement a logistic-style probability function in TypeScript. This is acceptable for the demo and avoids a Python service. The UI must honestly call it a **demo trained-model artifact** or **deterministic model artifact** unless actual training code and evaluation results are included.

Also implement the baseline rule and expose a comparison result:

- Baseline: trigger if available balance ratio is below a configured threshold.
- Model: probability from the model artifact.
- Policy: expected-value calculation plus hard safety envelope.

Do not fabricate claims that the model beats a baseline unless the evaluation script has actually calculated them from the seeded dataset.

## Economic policy

Implement:

```text
expectedValuePaise =
  expectedBenefitPaise
  - opportunityCostPaise
  - riskCostPaise
```

Where:

```text
expectedBenefitPaise = probability * merchantBenefitPaise
riskCostPaise = (1 - probability) * estimatedRiskPaise
```

Use integer-safe rounding. The policy must consider:

- model probability
- supplier payable amount
- proposed discount in basis points
- merchant benefit
- platform opportunity cost
- estimated downside risk
- daily/platform exposure budget
- absolute per-transaction discount cap

Recommended demo policy defaults:

- maximum discount: 150 basis points
- maximum single discount cost: ₹2,500.00
- minimum expected value: ₹0.00
- maximum payout exposure per opportunity: ₹2,00,000.00
- low-confidence decisions go to review

The policy output must include:

- `approvedByPolicy: boolean`
- `expectedValuePaise`
- `recommendedDiscountBps`
- `maxAllowedDiscountPaise`
- `decisionReason`
- `policyVersion`
- `riskEnvelope`

The model cannot directly initiate a payment. Only the deterministic policy service can recommend approval, and only an authorized demo operator can approve the payout.

## Approval transaction

When an operator approves an opportunity:

1. Start a Prisma transaction.
2. Lock or safely re-read the opportunity.
3. Reject if it is not `RECOMMENDED`.
4. Recalculate the policy server-side; never trust a client-submitted amount or probability.
5. Create a `PaymentIntent` with `INTENT_CREATED`.
6. Create balanced ledger entries.
7. Create an audit event.
8. Create an outbox event.
9. Commit all internal changes atomically.
10. Submit the provider operation using the generated idempotency key and request fingerprint.
11. Update the payment state according to the provider result.
12. Process or simulate a webhook.
13. Show the final state and reconciliation status in the GUI.

If provider submission times out, set the payment to `UNKNOWN` and never silently mark it failed. The demo controls must allow the operator to run reconciliation and resolve it.

---

# 7. FAILURE-INJECTION DEMO

This is the most important feature of the entire application. Build a visible Demo Controls page and a “Run Hero Demo” button.

The hero demo must execute this sequence:

1. Reset the demo to a known seeded state.
2. Select supplier `Aarav Industrial Components` with a recommended opportunity.
3. Display the model probability, baseline decision, expected value, discount, and hard cap.
4. Approve the opportunity.
5. Create the internal intent and ledger atomically.
6. Submit a mock provider operation.
7. Inject `TIMEOUT_AFTER_REMOTE_SUCCESS`.
8. Display the payment as `UNKNOWN`, not failed.
9. Inject a duplicate provider webhook.
10. Verify that the duplicate is ignored using webhook idempotency/event id.
11. Run reconciliation.
12. Discover the provider operation and transition the internal payment to `CONFIRMED` exactly once.
13. Display one balanced ledger transaction, one provider operation, duplicate-event handling, and a successful reconciliation result.

Add individual controls for:

- Duplicate webhook
- Provider timeout after remote success
- Provider timeout before processing
- Provider decline
- Delayed webhook
- Amount mismatch
- Missing internal record
- Contradictory dispute evidence
- Reset all demo data

Every scenario must be deterministic and repeatable. The UI must show a timeline with timestamps and correlation ID.

Create `DEMO_SCRIPT.md` with a two-minute presentation script. The first screen of the demo must explain the business problem and not begin with an architecture diagram.

---

# 8. OUTBOX AND EVENT PROCESSING

Every state-changing internal transaction must create an outbox record in the same database transaction as the state change.

Implement an outbox publisher service callable from a demo button and optionally from a lightweight development interval. Do not require a background worker for the app to function.

The publisher must:

- fetch pending events in order of availability
- increment attempt count
- publish to the local event record transport
- mark the outbox row published
- record errors without deleting failed events
- use exponential backoff for retryable failures
- move exhausted events to `FAILED`

The GUI must show outbox status and failed events. Provide a “Publish pending events” button in Demo Controls.

Event payloads must include:

```json
{
  "eventId": "...",
  "eventType": "PAYMENT_INTENT_CREATED",
  "schemaVersion": "1.0",
  "aggregateType": "PAYMENT_INTENT",
  "aggregateId": "...",
  "sequenceNumber": 1,
  "correlationId": "...",
  "occurredAt": "...",
  "payload": {}
}
```

---

# 9. RECONCILIATION

Create a reconciliation service that compares internal `PaymentIntent` records with simulated provider records.

Outcomes:

- `MATCHED`
- `MISSING_INTERNAL`
- `MISSING_EXTERNAL`
- `AMOUNT_MISMATCH`
- `STATUS_MISMATCH`
- `DUPLICATE`

Rules:

1. Reconciliation never blindly overwrites internal state.
2. A mismatch creates or updates a reconciliation case.
3. A critical mismatch can freeze the affected operation or require manual review.
4. A matched operation records the provider reference, amount, status, and correlation ID.
5. Duplicate provider events do not create duplicate financial postings.
6. Resolution requires an explicit action and audit event.

Build a Reconciliation page with filters, status badges, detail drawers, and a resolve action. The resolve action must require a note. It must not silently repair monetary data.

---

# 10. SECONDARY WORKFLOW: DISPUTE EVIDENCE

Implement one narrow dispute reason-code workflow. Use a single supported demo reason code such as `PRODUCT_NOT_RECEIVED`.

The workflow:

1. Load a dispute case.
2. Load evidence documents such as a delivery note, order record, and customer communication.
3. Extract structured claims with:
   - claim text
   - normalized field
   - normalized value
   - confidence
   - source document ID
   - exact source span
   - contradiction flag
4. Generate a draft only from structured evidence claims.
5. Validate the draft deterministically.
6. If evidence is missing or contradictory, set `NEEDS_REVIEW` and do not produce an auto-submittable draft.
7. Auto-submission must be disabled in the prototype.

The draft validator must check:

- supported reason code
- required fields
- amount consistency
- date consistency
- no unsupported factual claims
- every factual claim maps to one or more evidence claims
- contradictory evidence causes review
- no prohibited language such as “guaranteed,” “certain,” or unsupported accusations

Do not send real documents or sensitive data to an external LLM. For zero-key demo mode, use a deterministic template generator. If an LLM adapter is added, keep it server-side, optional, disabled by default, and behind a clearly labeled feature flag.

The Dispute Evidence page must visibly show:

- evidence document cards
- extracted claims
- source spans
- contradiction warnings
- generated draft
- validation checklist
- “Needs human review” state
- auto-submission disabled notice

---

# 11. DASHBOARD REQUIREMENTS

Create an Overview page that answers, in order:

1. What financial opportunity is available?
2. What is the system recommending?
3. How much exposure is controlled by policy caps?
4. Are payment operations healthy?
5. Are there reconciliation exceptions?
6. What happened in the latest demo scenario?

Required dashboard components:

- KPI card: recommended opportunities
- KPI card: expected value in rupees
- KPI card: active payment intents by lifecycle status
- KPI card: open reconciliation cases
- opportunity table
- recent payment timeline
- risk and policy summary
- demo mode banner
- provider mode indicator: `MockRazorpay` or `Razorpay Test Mode`
- system health indicator

Do not show one opaque “Business Health Score” as the primary intelligence. Show separate legible values. If a roll-up score is used, label it as secondary.

The Liquidity Opportunities page must support:

- sorting by expected value, probability, amount, and status
- filtering by status and risk tier
- detail drawer/modal
- model feature snapshot
- baseline versus model comparison
- economic calculation breakdown
- policy envelope
- approve/reject actions
- confirmation dialog before approval

The Payments page must support:

- lifecycle status badges
- provider reference
- amount
- idempotency key masked except last four characters
- request fingerprint shortened
- correlation ID
- ledger balance status
- webhook/event timeline
- retry/reconciliation action where appropriate

---

# 12. API CONTRACTS

Create Zod schemas for all API inputs and outputs. Implement at least these endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health and database check |
| GET | `/api/dashboard` | Dashboard summary |
| GET | `/api/opportunities` | List/filter opportunities |
| GET | `/api/opportunities/:id` | Opportunity detail |
| POST | `/api/opportunities/:id/approve` | Approve and initiate payout workflow |
| POST | `/api/opportunities/:id/reject` | Reject opportunity |
| GET | `/api/payments` | List payment intents |
| GET | `/api/payments/:id` | Payment detail and timeline |
| POST | `/api/webhooks/razorpay` | Receive provider webhook |
| POST | `/api/reconciliation/run` | Run reconciliation |
| GET | `/api/reconciliation` | List reconciliation cases |
| POST | `/api/reconciliation/:id/resolve` | Resolve with mandatory note |
| GET | `/api/disputes/:id` | Dispute and evidence detail |
| POST | `/api/disputes/:id/draft` | Generate and validate draft |
| POST | `/api/demo/reset` | Reset seeded demo state |
| POST | `/api/demo/scenario` | Run a named failure scenario |

Every mutation must accept or generate a correlation ID and idempotency key. If the client sends an idempotency key, bind it to the request fingerprint.

Use HTTP statuses consistently:

- `200` successful read or action
- `201` created resource
- `400` validation error
- `401/403` unauthorized demo role action if implemented
- `404` missing resource
- `409` idempotency conflict or invalid state transition
- `422` policy rejection or evidence validation failure
- `500` unexpected server error

Do not leak stack traces to the browser. Log a safe server-side error with correlation ID.

---

# 13. ROLE AND SAFETY CONTROLS

Implement a demo operator role model even if real login is out of scope:

- `VIEWER`: can view dashboards and details
- `FINANCE_APPROVER`: can approve discount payouts
- `RECONCILIATION_OPERATOR`: can resolve reconciliation cases
- `DISPUTE_REVIEWER`: can approve evidence drafts for manual submission

For the demo, use a fixed server-side demo operator identity from environment configuration. Make the current role visible in the header.

Enforce separation of duties in code:

- a viewer cannot approve payouts
- a finance approver cannot resolve critical reconciliation cases
- a reconciliation operator cannot modify a model decision
- no role can enable automatic dispute submission

Audit every protected action with actor type, actor ID, role, reason, correlation ID, and aggregate ID.

---

# 14. OBSERVABILITY

Implement structured server logging with these fields where relevant:

- timestamp
- level
- event name
- correlation ID
- request ID
- actor ID
- aggregate type/id
- provider reference
- payment status
- model version
- policy version
- duration milliseconds
- outcome
- error code

Redaction policy:

- never log provider secrets
- never log full webhook signatures
- never log full credentials or payment card data
- mask idempotency keys except a short suffix
- avoid raw AA data
- use document IDs and source spans rather than unnecessary sensitive document content

Add an Operations section showing:

- event processing latency
- provider success/failure counts
- `UNKNOWN` payment count
- open reconciliation count
- model decision count
- dispute draft validation failures
- outbox failures

Use simple database-derived demo metrics; do not invent live monitoring claims.

---

# 15. MODEL EVALUATION AND IMPACT

Create a deterministic evaluation script over the seeded synthetic observations. It must compare:

1. Rule baseline.
2. Logistic-style model artifact.
3. Policy decisions under economic constraints.

Use a time-ordered split in the generated dataset. Report, where calculable:

- precision
- recall
- F1
- PR-AUC or a clearly labeled simplified proxy if the dataset is too small
- calibration summary
- expected-value total
- avoided unjustified discount cost
- captured legitimate opportunity percentage

Do not fabricate performance. If the synthetic sample is too small for statistically meaningful metrics, label results as **illustrative demo metrics**.

Display a concrete before/after impact card such as:

- baseline eligible amount
- policy-approved amount
- expected value captured
- discounts avoided by the cap
- opportunities routed to review

The exact values must be computed by code from the seeded dataset, not hard-coded in the UI.

---

# 16. SEED DATA

Create realistic but synthetic Indian marketplace data. Do not use real people, real bank data, real Account Aggregator data, or real production credentials.

Seed at least:

- 6 suppliers
- 30 chronological liquidity observations
- 8 opportunities across recommended, approved, rejected, and expired states
- 5 payment intents across confirmed, unknown, failed, and manual review states
- 1 successful duplicate-webhook example
- 2 reconciliation cases, including one amount mismatch
- 2 dispute cases: one with complete evidence and one with contradictory evidence
- outbox events and audit events
- model evaluation data

Use names such as:

- Aarav Industrial Components
- Nila Packaging Works
- Saffron Retail Supply
- Meridian Home Goods
- Kaveri Logistics Parts
- Orbit Kitchenware

Make the main hero scenario deterministic and easy to reset.

---

# 17. TESTING REQUIREMENTS

Do not stop after the app compiles. Add tests before declaring completion.

## Unit tests

Test:

- paise arithmetic and formatting
- request fingerprint stability
- idempotency-key conflict detection
- expected-value calculation
- policy cap enforcement
- state-transition validity
- double-entry ledger balance
- sequence numbering per aggregate
- evidence claim source-span validation
- contradictory-evidence detection
- draft validation
- model fallback behavior

## Integration tests

Test:

- approval transaction creates payment intent, ledger transaction, audit event, and outbox event
- repeated approval with same idempotency key does not create duplicate money movement
- same idempotency key with different payload returns conflict
- timeout produces `UNKNOWN`
- reconciliation resolves unknown after provider confirmation
- duplicate webhook does not duplicate ledger postings
- amount mismatch creates a case and does not silently overwrite internal state
- unauthorized role cannot approve or resolve protected actions

## Browser tests

Use Playwright to verify:

1. The app loads at `/` with no console errors.
2. The dashboard displays seeded data.
3. The user can open an opportunity detail.
4. The user can approve an opportunity and see the payment timeline.
5. The hero failure scenario completes and shows `UNKNOWN` followed by reconciliation.
6. The dispute page shows source spans.
7. Contradictory evidence causes `NEEDS_REVIEW`.
8. Reset Demo returns the application to the initial state.
9. All navigation links work.
10. No page depends on a manually started second server.

Add a simple script or documented command to run the full test suite.

---

# 18. ERROR-PREVENTION CHECKLIST

Before declaring the project complete, perform all checks below:

- Run `npm run typecheck` and fix every error.
- Run `npm run lint` and fix every error or document a justified exception.
- Run `npm test` and fix every failing test.
- Run `npm run build` from a clean state.
- Run the app and verify `/api/health`.
- Verify database migrations work on a fresh database.
- Verify seed is idempotent or reset-safe.
- Verify all client fetches use the typed API client.
- Search for hard-coded localhost API URLs and remove them.
- Search for `any` and remove it from financial, API, and database code.
- Search for floating-point monetary calculations and replace them with paise integers.
- Search for secrets in source, logs, and client bundles.
- Verify all API routes return the common envelope.
- Verify no server-only imports enter client components.
- Verify mutation buttons cannot be double-submitted.
- Verify every status transition is validated server-side.
- Verify the dashboard works with an empty list and an API failure.
- Verify the demo runs without external keys.
- Verify the real provider adapter cannot activate accidentally when credentials are absent.
- Verify the UI clearly says `Demo Mode` and `MockRazorpay`.

If any check fails, fix it before producing the final response.

---

# 19. DOCUMENTATION REQUIREMENTS

Create these documents:

## README.md

Include:

- what Equilibrium does
- the hero demo story
- architecture diagram in Mermaid
- prerequisites
- installation commands
- environment variables
- database setup
- how to run
- how to test
- how to reset demo data
- how to enable optional Razorpay test mode
- security warning against live credentials
- limitations
- demonstrated/designed/out-of-scope table

## ARCHITECTURE.md

Include:

- source-of-truth hierarchy
- request lifecycle
- provider adapter lifecycle
- outbox flow
- reconciliation flow
- accounting model
- idempotency model
- correlation-ID propagation
- why the default demo uses SQLite and local event transport
- how production could replace them with Postgres and Redis without changing domain contracts

## SECURITY_SCOPE.md

Include:

| Demonstrated | Designed but not implemented | Out of scope |
|---|---|---|
| Server-side provider adapter, role checks, redacted logs, audit events, provider-mode banner, synthetic data | Key rotation, secrets manager, tenant isolation, formal threat model, retention enforcement, breach response | Live AA data, live customer data, automated dispute submission, production certification |

Never call the prototype PCI-compliant, DPDP-compliant, AA-certified, or production-ready.

## DEMO_SCRIPT.md

Include a two-minute script:

1. State the marketplace finance problem.
2. Show a quantified synthetic baseline versus policy result.
3. Approve one opportunity.
4. Inject provider timeout after remote success.
5. Show `UNKNOWN`, duplicate webhook handling, and reconciliation.
6. Show the balanced ledger and audit timeline.
7. Briefly show the dispute evidence refusal path.
8. Close with the scope boundary and safety principle.

---

# 20. OPTIONAL RAZORPAY TEST-MODE ADAPTER

Implement this only if it can be done without weakening demo mode.

Requirements:

- all Razorpay credentials remain server-only
- `RAZORPAY_MODE=mock` is the default
- live/test adapter activates only when explicitly configured
- the UI displays the active provider mode
- errors from Razorpay are normalized into the internal provider result type
- provider request and response data are redacted in logs
- real payments must never be initiated automatically
- webhooks must be signature-verified when a webhook secret exists
- the README must explain that test-mode behavior may require account-specific setup

If the real adapter introduces setup uncertainty, leave it as a clean interface and make MockRazorpay exceptionally complete. A reliable demo is more important than an unreliable live integration.

---

# 21. FINAL ACCEPTANCE CRITERIA

The project is complete only when all of the following are true:

1. A fresh checkout can be started with the documented commands.
2. The browser GUI loads at `http://localhost:3000` without a second server.
3. The dashboard contains seeded synthetic data.
4. The hero workflow is executable through the GUI.
5. The provider timeout scenario produces `UNKNOWN`, not a false failure.
6. Duplicate webhook handling is visible and idempotent.
7. Reconciliation finds and resolves the simulated provider outcome.
8. The internal ledger is balanced and immutable through application behavior.
9. The policy enforces a hard monetary cap even when the model probability is high.
10. Model version, feature snapshot, policy version, and timestamp are stored with every decision.
11. The dispute workflow shows evidence provenance and refuses unsupported or contradictory claims.
12. There is no automatic live dispute submission.
13. All monetary values use integer paise.
14. All API calls use same-origin typed contracts.
15. No secret is exposed to the browser.
16. Unit, integration, and browser smoke tests pass.
17. The README explains exactly what is demonstrated, designed, and out of scope.
18. The application visibly identifies itself as a demo prototype and does not claim production certification.

---

# 22. REQUIRED AGENT WORKING METHOD

Build in this order and do not skip validation between phases:

### Phase A — Scaffold and baseline

Create the Next.js app, install dependencies, configure TypeScript, Tailwind, Prisma, Vitest, and Playwright. Start the app and verify the empty GUI and `/api/health`.

### Phase B — Database and seed

Create the schema, migration, seed data, Prisma singleton, and reset behavior. Verify the database independently.

### Phase C — Domain services

Implement money, accounting, policy, idempotency, events, audit, provider adapters, reconciliation, and dispute services. Add unit tests before UI work.

### Phase D — API routes

Implement Zod schemas, typed envelopes, API routes, server-side validation, and integration tests. Verify every route with tests or a scripted request.

### Phase E — GUI

Build layout, navigation, dashboard, opportunity detail, payments, reconciliation, dispute evidence, demo controls, and scope pages. Connect only through the typed API client.

### Phase F — Failure demo

Implement and test all demo scenarios, especially timeout-after-remote-success, duplicate webhook, reconciliation, and contradictory evidence.

### Phase G — Hardening

Run typecheck, lint, unit tests, integration tests, Playwright, production build, fresh-database startup, and manual browser verification. Fix all issues.

### Phase H — Documentation

Write README, architecture, security scope, and demo script. Ensure documentation matches the actual implementation.

After each phase, report what was completed and what tests passed, but continue autonomously unless a genuinely impossible decision requires user input. Do not stop at a plan or partial scaffold. Implement the complete application.

## Final instruction

Prioritize **one reliable, visually clear, financially safe hero workflow** over extra features. Never hide uncertainty. Never fake production integrations. Never claim a model metric, Razorpay transaction, compliance status, or safety control that the code does not actually demonstrate.

The final result must feel like a coherent Razorpay Buildathon product, not a collection of disconnected technologies.
