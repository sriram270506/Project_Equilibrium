# What is real, what is simulated, what is not built

The single most useful thing this document can do is stop a reviewer wasting
time working out which is which. Everything below is checkable in the code.

## Real — implemented and verified in this repository

| Capability | Where | How to verify |
|---|---|---|
| Double-entry journal with a declared chart of accounts | [src/lib/ledger/accounts.ts](../src/lib/ledger/accounts.ts) | `npm test` — 18 accounting tests |
| Unbalanced journals rejected at the service boundary | `assertJournalBalanced` | Throws before any write |
| Compare-and-swap on approval; no double payment under concurrency | [opportunity-service.ts](../src/server/opportunity-service.ts) | `demo:verify` fires 10 parallel approvals |
| Maker-checker with self-approval refused server-side | `confirmSecondApproval` | `demo:verify` asserts it |
| Risk limits enforced before any write, plus a kill switch | [src/lib/risk/controls.ts](../src/lib/risk/controls.ts) | `demo:verify` engages it and confirms a block |
| Webhook HMAC-SHA256 over the raw body, timing-safe | [webhook-security.ts](../src/lib/payments/webhook-security.ts) | 26 tests |
| Webhook replay window and Zod validation | same | same |
| Webhook fails closed outside mock mode | `authenticateWebhook` | Tested for `live` and `test` modes |
| Exactly-once webhook processing | `EventRecord.idempotencyKey` unique index | DB constraint, not application convention |
| Transactional outbox with retry, backoff, and dead-letter | [event-service.ts](../src/lib/events/event-service.ts) | `GET /api/internal/events/publish` |
| Tamper-evident audit chain | [src/lib/audit.ts](../src/lib/audit.ts) | Tamper button on `/dashboard/controls` |
| Reconciliation against the provider, repairing only the safe direction | [reconciliation-service.ts](../src/lib/reconciliation/reconciliation-service.ts) | `demo:verify` resolves an UNKNOWN |
| Exception resolution requiring an operator and a written reason | `POST /api/reconciliation/:id/resolve` | Rejects a reason under 15 characters |
| Fitted model with held-out metrics and permutation controls | [scripts/train-model.ts](../scripts/train-model.ts) | `npm run ml:train` |
| Exact per-feature explanations and counterfactuals | [src/lib/ml/explain.ts](../src/lib/ml/explain.ts) | Any offer detail page |
| Role-based auth on every mutating route | [src/lib/auth/guard.ts](../src/lib/auth/guard.ts) | `withAuth` wrapper |
| Structured JSON logging with correlation ids | [logger.ts](../src/lib/observability/logger.ts) | Any request |
| Health and metrics endpoint | `GET /api/health` | Reports degraded states |
| Deterministic seed | [src/lib/demo/seed.ts](../src/lib/demo/seed.ts) | Two runs hash identically |
| Multi-tenant isolation | [src/lib/tenancy/](../src/lib/tenancy/) | `demo:verify` creates a second tenant and proves queries do not cross |
| Per-tenant roles | `TenantUser.role` | A role grants nothing outside its own tenant |

## Simulated — works, but against a simulator rather than reality

| Thing | What is simulated | What that means |
|---|---|---|
| **Payment provider** | `MockRazorpay` implements the same interface as the live adapter, with injectable failures | The reliability behaviour is real; the counterparty is not. A live adapter exists ([razorpay-adapter.ts](../src/lib/payments/razorpay-adapter.ts)) but is **unverified** until `npm run razorpay:check` passes with test credentials |
| **Supplier data** | 12 suppliers, 30 days of generated cash-flow observations each | No real business has ever been scored |
| **Model training data** | 4,000 simulated suppliers with a seven-day forward cash simulation | Features **and** labels come from the same generator. AUC 0.959 measures the model against that simulator, not against real supplier behaviour |
| **Provider fees and cost of capital** | Fixed assumptions (25 bps, 800 bps annualised) | Plausible, not sourced from a real rate card |
| **Risk limits** | Chosen to make the demo exercise every path | Not derived from a supplier cohort or a default-rate model |
| **Dispute evidence** | One seeded case with deliberately contradictory claims | Extraction from real documents is not implemented |

## Not built — deliberately out of scope

These would be required for production and are **not** present. No part of the
UI or documentation should be read as claiming otherwise.

**Accounting.** Multi-currency and FX revaluation, period close, tax (GST/TDS),
intercompany accounts, accrual-basis recognition, statutory chart-of-accounts
mapping. The journal is single-entity, single-currency, cash-basis.

**Infrastructure.** PostgreSQL (uses SQLite), migration history (uses
`db push`), a durable queue, a background worker (the outbox drains via an
endpoint), horizontal scaling, load testing, capacity planning.

**Security.** Session authentication (API keys only), tenant isolation, rate
limiting, CSRF, secret-management integration, key rotation, encryption at
rest, a formal threat model, dependency/supply-chain review.

**Operations.** Runbook beyond [RUNBOOK.md](RUNBOOK.md), disaster recovery
testing, backup/restore procedures, alerting and on-call, SLOs, distributed
tracing.

**ML operations.** Model registry, feature store, drift monitoring, A/B testing,
automated retraining, fairness evaluation across supplier segments.

**Product.** Any evidence that real marketplaces want this, that suppliers would
accept these terms, or that the legal and contractual basis for changing payment
timing exists.

## The honest summary

The correctness and reliability machinery is real and testable. The data,
the counterparty, and the business case are not. This is a working prototype of
a payment-operations control layer, evaluated against its own simulator.

`npm run demo:verify` checks 39 invariants across every "Real" row above. It
cannot check anything in the other two tables, and no amount of engineering
would let it.
