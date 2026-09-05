# Equilibrium

**Small suppliers go broke waiting to get paid — not because they lack revenue.**

A supplier delivers goods on Monday and gets paid 30 days later. Payroll is on
Friday. That gap is the single largest cause of MSME failure in India, and it
has nothing to do with whether the business is any good.

Equilibrium is an AI Finance Controller that predicts which marketplace suppliers are about to run short of cash,
offers them their own receivables early at a fair price, and then moves that
money with the reliability guarantees a bank requires.

The controller reads messy invoice state, detects and explains anomalies,
evaluates liquidity opportunity, and proposes the next safe finance operation
through typed read-only tools. Deterministic policy, human approval, payment,
ledger, and reconciliation controls remain authoritative; the AI cannot move
money directly.

---

## The trade, in one example

Aarav Industrial Components is owed **₹1,50,000** on an invoice due in 27 days.
At their current burn rate they run out of cash in 2.5 days. They are not
insolvent — they are illiquid, which is a different and fixable problem.

| | |
|---|---|
| **Without Equilibrium** | Borrow at ~24%, delay wages, or default to their own suppliers |
| **With Equilibrium** | Receive **₹1,48,200 today** instead of ₹1,50,000 in 27 days |
| **The price** | A 1.20% discount — **16.2% annualized**, well under their alternative |
| **The platform earns** | **₹1,800** on capital it was holding idle anyway |

Both sides are better off than doing nothing. The annualized rate is shown
everywhere the discount is, because a 1.2% headline over 27 days is *not* a 1.2%
cost — and quoting only the headline is how suppliers get quietly overcharged.

---

## Why this is an engineering problem, not a spreadsheet

Deciding to pay is easy. Paying correctly, every time, is the hard part. The
moment real money moves, the interesting failures start:

| Guarantee | How |
|---|---|
| **Never pay twice** | Every instruction carries an idempotency key and a SHA-256 request fingerprint. A retry returns the original result instead of sending a second payment. |
| **Never lose a rupee** | Every movement writes balanced double-entry ledger rows *inside the same transaction* as the payment. The trial balance proves the books foot at any moment. |
| **Survive not knowing** | When a provider call times out we record `UNKNOWN` rather than guessing. Reconciliation later compares our state against the provider and resolves it. |
| **Process each event once** | Webhooks are verified by HMAC-SHA256 with a timing-safe comparison and deduplicated on the provider's event id. |
| **Explain every decision** | Each recommendation stores its feature snapshot and model version, so months later you can reconstruct exactly why money moved. |
| **Bound the blast radius** | Daily exposure, per-transaction, and per-supplier limits are enforced *before* money moves — plus a kill switch and maker-checker above a threshold. |
| **Detect tampering** | The audit log is a hash chain. Editing any historical row breaks every hash after it. |
| **Isolate tenants** | Every business record carries a non-nullable `tenantId`, and roles live on the membership. One marketplace cannot read another's suppliers, payments, or audit trail. |

---

## Run it

Zero external credentials. No Razorpay account, no real money, synthetic data only.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and click **Run the 5-minute demo**.

### Prove it works, in one command

```bash
npm run demo:verify
```

This drives the real services end to end — scores every supplier, approves and
pays, clears a maker-checker gate, injects a provider timeout, replays a
webhook, reconciles, and checks the books — asserting **49 invariants** and
exiting non-zero if any fails. The invoice/controller path is also covered by
duplicate-upload, arithmetic-mismatch, similar-invoice, and controller-audit
checks.

### Optional real AI providers

The default `AI_PROVIDER=mock` keeps local development and CI credential-free.
For real invoice extraction and read-only explanations, set `AI_PROVIDER=azure`
and provide:

```text
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://<resource>.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=<secret>
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_KEY=<secret>
AZURE_OPENAI_DEPLOYMENT=<chat-deployment-name>
AZURE_OPENAI_API_VERSION=2024-10-21
```

Document Intelligence extraction is schema-validated before invoice persistence.
Azure OpenAI receives only validated fields and deterministic reason codes, must
return `{ "explanation": "..." }`, and is limited to a 2.5-second read-only
explanation call. Any timeout or invalid output falls back to
`explanation unavailable`.

```
  PASS  Model beats the runway<7d baseline on held-out AUC — 0.959 vs 0.940
  PASS  The maker cannot approve their own payment
  PASS  A timeout is recorded as UNKNOWN, not guessed either way
  PASS  Our view and the provider's genuinely diverge — we say UNKNOWN, provider says CONFIRMED
  PASS  A replayed webhook creates no new event records — 0 net new records
  PASS  Reconciliation resolved every unknown payment — 1 before, 0 after
  PASS  Total debits equal total credits after two injected failures — Rs 1,58,211.22 = Rs 1,58,211.22
  PASS  Every audit entry hashes correctly and links to its predecessor
  PASS  The kill switch refuses new payments while engaged
  PASS  Fetching another tenant's record by id returns nothing

  48 passed, 0 failed
```

### Retrain the model

```bash
npm run ml:train
```

Fits the logistic regression on a synthetic cash-flow simulation with a held-out
split, prints AUC / precision / recall / confusion matrix against the baseline
rule, and refuses to write the artifact if the model does not beat that
baseline.

---

## The model

A logistic regression predicting the probability of a cash shortfall within
seven days. **Fitted, not hand-written** — `scripts/train-model.ts` produces the
coefficients the application actually scores with.

| Metric | Model | Baseline (`runway < 7 days`) |
|---|---|---|
| AUC | **0.959** | 0.940 |
| Precision | **43%** | 23% |
| Recall | 95% | 100% |

The baseline catches everyone by flagging almost everyone. The model reaches
comparable recall while making roughly **half as many unnecessary offers**.

**The decision threshold is 0.16, not 0.50.** The two errors do not cost the
same: flagging a healthy supplier means offering them cheap capital they did not
strictly need, while missing a distressed one means they miss payroll. The
threshold is chosen by sweeping candidate values and maximising a
recall-weighted F-score (β = 3) on the training split only. At the conventional
0.50 this model recalls 15% of distressed suppliers — useless for its purpose.

**Why a logistic regression and not something bigger.** It is additive in
log-odds, so every prediction decomposes *exactly* into per-feature
contributions. The explanations shown to operators are the model itself, not a
post-hoc approximation of it. For a system that moves money and must be
explainable to an auditor, that is worth more than a few points of accuracy.

The [model card](/dashboard/model) states the limitations plainly: it is trained
on generated data, has had no fairness evaluation, assumes independent daily
cash flows, and is not monitored for drift.

---

## What to look at

| Screen | What it shows |
|---|---|
| **Track 04 benchmark** | 546 labelled finance-operation records scored live, with the honest exception list and what the score does *not* prove — see [docs/TRACK04.md](docs/TRACK04.md) |
| **Exception review** | The queue where a human resolves what the controller refused to clear; every action attributed, and a reason required |
| **Run history** | Every recorded evaluation with its dataset and controller version, so a change in score is interpretable |
| **Guided walkthrough** | Seven steps against the real services; two deliberately break the provider |
| **Suppliers at risk** | 30-day runway chart, exact per-feature model contributions, a counterfactual, and the money split both ways |
| **Money movement** | One payment end to end: lifecycle rail, our view vs the provider's, ledger entries, hash-chained timeline |
| **Exceptions** | Reconciliation queue with both sides of each disagreement side by side |
| **Trial balance** | Debits, credits, difference — the "no rupee is lost" proof |
| **Risk controls** | Live exposure, limits, kill switch, and a button that tampers with the audit log so you can watch the chain break |
| **Failure injection** | Break the provider on purpose and see what the system does |

---

## Architecture

```
Observation → Model → Policy → Risk controls → Maker-checker
                                                    ↓
                            ┌───────── one transaction ─────────┐
                            │  payment intent                   │
                            │  balanced ledger entries          │
                            │  hash-chained audit record        │
                            │  outbox event                     │
                            └───────────────────────────────────┘
                                                    ↓
                          Provider (idempotency key) → webhook (HMAC + dedupe)
                                                    ↓
                              Reconciliation → trial balance → audit verification
```

**Stack.** Next.js 16 (App Router), TypeScript strict, Prisma + SQLite, Zod at
every route boundary, Tailwind, Recharts, Vitest.

**Provider.** All calls go through a `PaymentProvider` interface. `MockRazorpay`
implements it with injectable failure modes, so a live Razorpay adapter can
replace it without touching business logic.

Design decisions and trade-offs are in [ARCHITECTURE.md](ARCHITECTURE.md).
What is real versus simulated is in [docs/SCOPE.md](docs/SCOPE.md).
Operational procedures are in [docs/RUNBOOK.md](docs/RUNBOOK.md).

---

## What is real, simulated, and not built

[docs/SCOPE.md](docs/SCOPE.md) is a three-table breakdown of exactly which
capabilities are implemented and verified, which run against a simulator, and
which are deliberately absent. Read it before judging any claim on this page.

The short version: **the correctness machinery is real and testable; the data,
the counterparty, and the business case are not.**

## Honest limitations

This is a prototype built for a buildathon, and the following are true:

- **No real money and no real supplier has ever touched it.** Synthetic data
  against a mock provider throughout.
- **The model is fitted on simulated data.** The probabilities are a useful
  ordering of risk, not calibrated default rates.
- **SQLite and `prisma db push`**, not Postgres with a migration history.
- **Auth is API-key based** with a demo-mode fallback that accepts
  unauthenticated requests as the seeded operator. That fallback is disabled
  outside demo mode, but a real deployment needs proper sessions.
- **The outbox is drained by an endpoint**, not by a separate worker process.
- **The audit chain detects silent edits, not a determined attacker** who has
  write access and recomputes the whole chain.

Everything above is enforced or verifiable in code. Nothing in this README is a
claim you have to take on trust — `npm run demo:verify` checks all of it.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app |
| `npm run demo:verify` | End-to-end verification of every claim above (49 checks) |
| `npm run track04:benchmark` | Score the finance-operations controller on 546 labelled records. Add `-- --record` to persist the run |
| `npm run ml:train` | Refit the model and print held-out metrics |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript, strict |
| `npm run lint` | ESLint |
| `npm run db:seed` | Reseed 12 suppliers with 30 days of history each |
| `npm run razorpay:check` | Prove (or disprove) the live Razorpay integration |

---

Built for Razorpay Buildathon 2026. Demo only — not for production use.
