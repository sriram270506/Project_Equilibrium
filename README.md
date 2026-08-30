# Equilibrium

**Bounded intelligence for safer payment operations**

Equilibrium is a Razorpay Buildathon prototype demonstrating a fintech operations control layer for marketplace finance. It showcases ML-assisted liquidity prediction, economic policy enforcement, safe discount payouts, provider integration resilience, and financial reconciliation.

## What Equilibrium Does

The primary workflow:
1. **Predict**: ML model estimates supplier liquidity stress using 5 core features
2. **Evaluate**: Economic policy calculates expected value and hard safety caps
3. **Approve**: Finance operator approves a discount payout opportunity
4. **Execute**: Safe payment workflow with provider integration
5. **Reconcile**: Detect and resolve mismatches between internal and external state

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- No external API keys, credentials, or cloud services required

### Installation

```bash
# Clone and navigate to project
cd Project_Equilibrium-1

# Copy environment template
cp .env.example .env.local

# Install dependencies
npm install

# Start development server
npm run dev
```

The GUI opens at **http://localhost:3000**

### Demo Reset

To reset demo data:

```bash
curl -X POST http://localhost:3000/api/demo/reset \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

## Hero Workflow (2 Minutes)

1. Go to **Liquidity Opportunities**
2. Find "Aarav Industrial Components" (RECOMMENDED status)
3. Click **View Details** — observe:
   - Model probability: 78%
   - Expected value: ₹1,150
   - Policy decision: Approved
4. Click **Approve Opportunity** → Creates payment intent
5. Go to **Payment Operations**
6. Click payment to see timeline and ledger
7. Go to **Reconciliation** and click **Run Reconciliation**
8. Verify reconciliation matched the payment

## Architecture Diagram

```
┌─ Frontend (React/Next.js) ─────────────────────────────────────┐
│  • Dashboard with KPIs, opportunities, payments, disputes      │
│  • Typed API client (same-origin only)                         │
│  • Client-side state management                                │
└────────────────┬─────────────────────────────────────────────────┘
                 │
            HTTP/JSON
                 │
┌─ Next.js API Routes ──────────────────────────────────────────┐
│  • /api/dashboard (KPIs)                                      │
│  • /api/opportunities (list, detail, approve)                │
│  • /api/payments (list, detail, timeline)                    │
│  • /api/reconciliation (run, list cases)                     │
│  • /api/disputes (detail, draft generation)                  │
│  • /api/demo (reset, scenario control)                       │
└────────────────┬─────────────────────────────────────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌─ Domain Services ─┬─ Provider ──────┬─ Event Log ────────┐
│ • Opportunities  │ • MockRazorpay   │ • Outbox events    │
│ • Payments       │ • Payment status │ • Event records    │
│ • Reconciliation │ • Webhook sim    │ • Audit trail      │
│ • Disputes       │                  │                    │
│ • ML Model       │                  │                    │
│ • Policy Engine  │                  │                    │
└──────────────────┴──────────────────┴────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
    ┌─ Prisma ─┐    ┌─ SQLite ─┐
    │ Client   │───→ │ dev.db   │
    └──────────┘    └──────────┘
```

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Next.js 16, TypeScript |
| Styling | Tailwind CSS 3 |
| UI Components | Lucide Icons, custom components |
| Database | Prisma ORM, SQLite (dev) |
| Validation | Zod schemas |
| ML | Deterministic TypeScript model artifact |
| Provider Integration | MockRazorpay adapter pattern |
| Testing | Vitest, Playwright |
| Dev Server | Next.js built-in dev server |

## Key Features Demonstrated

### ✓ Core Fintech Operations
- **Integer-only arithmetic**: All amounts in paise (100ths of rupees)
- **Balanced ledger**: Double-entry accounting with immutable entries
- **Idempotency**: Server-side request fingerprints prevent duplicate payments
- **Audit trail**: Immutable event log for all financial decisions

### ✓ ML & Policy
- **Logistic regression model**: Predicts liquidity stress from 5 features
- **Economic policy**: Caps discount %, evaluates expected value, enforces hard limits
- **Baseline comparison**: Rule-based decision vs. model prediction
- **Feature versioning**: Snapshots stored with every decision

### ✓ Provider Integration Resilience
- **Timeout handling**: UNKNOWN state when remote result indeterminate
- **Duplicate webhook detection**: Idempotency keys prevent double-booking
- **Reconciliation**: Detects amount/status mismatches
- **Provider adapter pattern**: Mock and real adapters implement same interface

### ✓ Safe Dispute Resolution
- **Evidence extraction**: Structured claims from documents
- **Contradiction detection**: Flags conflicting statements
- **Validation**: Refuses incomplete or invalid drafts
- **No auto-submission**: Manual review required

## API Reference

### Health Check
```bash
GET /api/health
```
Response: System status, database connectivity, provider mode

### Dashboard
```bash
GET /api/dashboard
```
Response: KPIs (opportunities, expected value, payments, reconciliation), recent activity

### Opportunities
```bash
GET /api/opportunities?status=RECOMMENDED&limit=50
GET /api/opportunities/:id
POST /api/opportunities/:id/approve
```

### Payments
```bash
GET /api/payments?limit=50
GET /api/payments/:id
```

### Reconciliation
```bash
GET /api/reconciliation?limit=50
POST /api/reconciliation/run
```

### Disputes
```bash
GET /api/disputes/:id
POST /api/disputes/:id/draft
```

### Demo Control
```bash
POST /api/demo/reset (body: {"confirm": true})
```

All responses use standard envelope:
```json
{
  "success": true,
  "data": { }
}
```

or

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { }
  }
}
```

## Data Model

### Core Entities
- **Supplier**: Marketplace vendor with risk tier
- **LiquidityOpportunity**: ML-evaluated early-payment offer
- **PaymentIntent**: Lifecycle-tracked financial operation
- **LedgerTransaction**: Double-entry accounting records
- **ReconciliationCase**: Internal vs. external state comparison
- **DisputeCase**: Evidence-based chargeback defense

### Support Entities
- **EventRecord**: Event-sourced audit trail
- **OutboxEvent**: Durable event transport
- **AuditEvent**: Immutable decision log
- **MockProviderRecord**: Simulated provider state

See `prisma/schema.prisma` for full schema.

## Running Tests

```bash
# Type checking
npm run typecheck

# Unit tests
npm run test

# Watch mode
npm run test:watch

# E2E tests (requires running server)
npm run test:e2e

# Build verification
npm run build
```

## Environment Variables

```env
DATABASE_URL=file:./prisma/dev.db
APP_MODE=demo
RAZORPAY_MODE=mock
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
DEMO_OPERATOR_ID=demo-finance-operator
NEXT_PUBLIC_APP_NAME=Equilibrium
```

## Scope & Boundaries

### ✓ Demonstrated
- ML-assisted decision support (not autonomous)
- Safe economic constraints and policy caps
- Double-entry ledger correctness
- Provider timeout/retry resilience
- Duplicate webhook idempotency
- Evidence-based dispute drafts
- Reconciliation and mismatch detection
- Audit logging and correlation tracking
- Server-side provider integration

### ⏳ Designed But Not Implemented
- Live Razorpay adapter (test mode only)
- Account Aggregator integration
- Automated dispute submission
- Escrow module
- Multi-currency support
- Background worker for outbox publishing
- Redis Streams event transport
- Tenant isolation and multi-tenancy
- Advanced RBAC

### 🚫 Out of Scope
- Production PCI-DSS compliance
- DPDP (India Privacy Law) certification
- Account Aggregator certification
- Live customer/payment data
- Real money transfers
- Full KYC/AML
- Formal threat model
- Security audit

## Important Disclaimers

**This is a Razorpay Buildathon prototype for demonstration purposes only.**

- Not production-ready
- Does not meet compliance requirements
- Uses synthetic data only
- MockRazorpay provider is simulated
- No real payments or customer data
- Do not use with real financial data

## Documentation Files

- **README.md** (this file): Overview and quick start
- **ARCHITECTURE.md**: Technical deep-dive and design rationale
- **SECURITY_SCOPE.md**: What is/isn't secured and why
- **DEMO_SCRIPT.md**: 2-minute presentation narrative

## Support & Feedback

This is a buildathon prototype. For questions or feedback, refer to the specification in the original build prompt.

---

**Built with ❤️ for Razorpay Buildathon**
