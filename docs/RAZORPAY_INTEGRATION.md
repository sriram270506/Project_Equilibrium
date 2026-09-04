# Which Razorpay primitive this uses, and why

A generic "provider" abstraction proves nothing. This document names the exact
API, the exact header, and the exact state machine, and marks honestly which
paths have been exercised and which have only been written.

---

## The primitive: RazorpayX Payouts

Equilibrium **disburses** money to suppliers. That is not what the Payments or
Orders APIs are for — those handle *acceptance*, collecting money from a payer.
The correct primitive for paying a vendor is **RazorpayX Payouts**.

```
POST https://api.razorpay.com/v1/payouts
Authorization: Basic base64(key_id:key_secret)
X-Payout-Idempotency: <our idempotency key>
```

Implemented in [`razorpay-adapter.ts`](../src/lib/payments/razorpay-adapter.ts),
`createPayout()`.

### Why the idempotency key is generated before the call

`X-Payout-Idempotency` is Razorpay's own header. Replaying a request carrying
the same value returns the original payout instead of creating a second one.

This is why `providerIdempotencyKey` is generated **server-side and persisted on
the PaymentIntent before the provider is contacted**, rather than being derived
afterwards from the response:

```ts
// opportunity-service.ts — inside the same transaction as the ledger entries
const providerIdempotencyKey = generateIdempotencyKey();
await tx.paymentIntent.create({ data: { providerIdempotencyKey, ... } });
```

If the process dies mid-call, the key is already durable. The retry carries the
same key, Razorpay recognises it, and the supplier is paid once. **Our
idempotency key and Razorpay's are the same key** — that is a design
consequence of this specific API, not decoration.

### The state machine comes from Razorpay, not from us

Payouts are genuinely asynchronous. A payout can sit in `processing` for
minutes. Razorpay's states map onto ours:

| Razorpay | Ours | Why |
|---|---|---|
| `queued`, `pending` | `SUBMITTED` | Accepted, not yet acted on |
| `processing` | `ACKNOWLEDGED` | In flight at the bank |
| `processed` | `CONFIRMED` | Money has moved |
| `reversed` | `REVERSED` | Returned after settlement |
| `cancelled`, `rejected`, `failed` | `FAILED` | Did not move |
| *(no response)* | `UNKNOWN` | **We do not know** |

That last row is the one that matters. `UNKNOWN` exists because a timeout
against this API is genuinely ambiguous — the payout may have been created. We
record uncertainty and let reconciliation settle it, rather than guessing.

A timeout is mapped **before** any success status, in
[`payment-service.ts`](../src/lib/payments/payment-service.ts):

```ts
// A timeout means we did not receive an answer, whatever the provider's
// own record happens to say. Checking CONFIRMED first would mean trusting
// information we never actually received.
if (timedOut || providerResult.status === "UNKNOWN") newStatus = "UNKNOWN";
else if (providerResult.status === "CONFIRMED") newStatus = "CONFIRMED";
```

---

## Webhooks

Razorpay signs the **raw request body** with the webhook secret using
HMAC-SHA256 and sends the hex digest in `X-Razorpay-Signature`.

Implemented in
[`webhook-security.ts`](../src/lib/payments/webhook-security.ts):

1. **Read raw bytes first.** Parsing and re-serialising JSON reorders keys and
   changes whitespace, which changes the digest. A very common way to get this
   subtly wrong.
2. **Timing-safe comparison** via `crypto.timingSafeEqual`.
3. **Fails closed.** Outside `RAZORPAY_MODE=mock`, a missing
   `RAZORPAY_WEBHOOK_SECRET` returns 500. It does not fall back to accepting
   everything.
4. **Replay window** of 24 hours, matching Razorpay's retry policy, with 5
   minutes of future clock skew allowed.
5. **Deduplication on the provider's event id**, enforced by a UNIQUE index on
   `EventRecord.idempotencyKey` — a database constraint, not an application
   check, so concurrent duplicate deliveries roll back rather than double-post.

Razorpay guarantees **at-least-once** delivery, never exactly-once. A receiver
that is not idempotent silently doubles its accounting.

---

## What is exercised, and what is not

| Path | Status |
|---|---|
| Mock provider, full lifecycle incl. injected failures | **Exercised** — 48 end-to-end checks |
| HMAC signature verification | **Exercised** — 26 unit tests |
| Replay-window rejection | **Exercised** |
| Duplicate-event deduplication | **Exercised** — verified concurrent |
| Live Orders API (`POST /v1/orders`) | **Written, unverified** — needs test keys |
| Live Payouts API (`POST /v1/payouts`) | **Written, unverified** — needs a RazorpayX account |
| `X-Payout-Idempotency` replay behaviour | **Written, unverified** |

To verify the live paths:

```bash
# .env — see docs/RUNBOOK.md
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
RAZORPAY_MODE=live

npm run razorpay:check
```

That creates a real Test Mode object, reads it back, checks 404 handling and
signature verification, and prints an id you can look up in the dashboard.
**Until it passes, the live integration is unproven and this document says so.**

Plain test keys reach the Orders API. Payouts needs a separate RazorpayX
account; with `RAZORPAY_API_MODE=orders` the adapter still demonstrates live
connectivity, authentication, and the reconciliation read path.

---

## Why this is better with Razorpay than with a generic provider

Three things this design takes from Razorpay specifically:

1. **`X-Payout-Idempotency` is a first-class header on the disbursement API.**
   Not every provider offers idempotency on payouts. Building the exactly-once
   guarantee on the provider's own mechanism is stronger than reimplementing it
   client-side and hoping.
2. **Payout status is honestly asynchronous**, with a documented state machine
   including `reversed`. That shape is what makes `UNKNOWN` and reconciliation
   necessary rather than theoretical — a provider that pretended to be
   synchronous would hide the problem, not remove it.
3. **Webhook signing over the raw body with a shared secret** is a well-specified
   contract, which is what allows the receiver to fail closed with confidence.

The `PaymentProvider` interface exists so the mock and the live adapter satisfy
identical semantics, not so the provider is interchangeable. Swapping to another
provider would mean re-deriving the idempotency guarantee against whatever that
provider offers, which is exactly the work this design avoids.
