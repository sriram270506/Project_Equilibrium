# Five-minute demo — shot list and voiceover

Screen-record in silence, then read the voiceover over it. Every number quoted
below is live in the build; nothing here is a mock-up.

**The two things that must survive any cut** are the *timeout surviving
reconciliation* (2:30) and the *zero false resolutions under degraded data*
(3:55). Everything else can be trimmed.

---

## Before you hit record

```bash
npm ci
npm run db:setup
npm run dev
```

Then, in a second terminal, put the system into a demo-ready state:

```bash
npm run track04:benchmark -- --record
```

Approve one offer from **Suppliers at risk** so *Money movement* is not empty,
then leave the browser on the landing page at `http://localhost:3000`.

Set the browser to **1440 × 900**, zoom 100%, and hide bookmarks. Close the
Next.js dev overlay if it appears.

Have a terminal ready on a second desktop for the 4:35 shot.

---

## 0:00 — 0:35 · The problem

**Screen** — Landing page, `/`. Hold on the masthead long enough for the
controller thesis to land, then scroll slowly to the
"A concrete case" panel with the three-way comparison.

> AI can recommend a payment. Equilibrium decides whether it is safe enough to
> execute. The model proposes, deterministic policy constrains, humans
> authorize, and the ledger proves what happened.
>
> A supplier delivers on Monday and gets paid thirty days later. Payroll is on
> Friday. The national average is seventy-three days against thirty-day terms —
> that figure is measured, from Recordent's 2026 receivables report across a
> hundred and ten thousand MSMEs.
>
> Aarav Industrial Components is owed one and a half lakh, due in twenty-seven
> days. At their burn rate they run out of cash in two and a half. They're not
> insolvent. They're illiquid — and that's fixable.

---

## 0:35 — 1:20 · The controller decides, and shows its work

**Screen** — Click **Open the operations console** → lands on `/dashboard`.
Pause on the callout and the four figures. Then click **Suppliers at risk** in
the sidebar, then the top supplier.

> This is the console. One sentence at the top says what needs a decision
> today, and every figure under it is computed live.
>
> Open a supplier and you get the thirty-day runway chart, the model's
> probability — and, critically, the *per-feature contribution*. You can see
> exactly which signal drove the score.

**Screen** — Scroll to the rate benchmark panel.

> And here's the part most demos leave out. We price this at sixteen point two
> percent annualised. TReDS — the RBI-licensed incumbent — discounts between
> eight and twelve. So the interface says, in its own words, that we are
> *dearer than the market*, and that this is defensible on access and speed,
> not on price.
>
> A pricing surface that only ever says "competitive" tells an operator
> nothing.

---

## 1:20 — 2:00 · Approve, and watch the effect

**Screen** — Click **Approve and pay**. Stay on the page. The *What just
happened* panel reveals four steps in sequence — let it play.

> Approving used to redirect you to a payment page and show nothing. Now it
> stays, and shows what actually changed.
>
> Six ledger entries posted — debits equal credits, written in the same
> transaction as the payment intent, so there is no moment where one exists
> without the other.
>
> The offer left the pending-approval queue — and note the arithmetic: the
> queue fell by exactly the offer amount.
>
> The supplier's median cash path no longer crosses zero.
>
> And the payment is confirmed, with an idempotency key. A retry after a crash
> returns the original payout rather than sending a second one.

---

## 2:00 — 2:30 · One payment, end to end

**Screen** — Click **Trace the payment →**, or sidebar → **Money movement** →
a payment. Scroll through the lifecycle rail, the two-column *our view vs the
provider's*, the ledger entries, and the hash-chained timeline.

> Every payment is traceable end to end. The lifecycle rail shows where it is
> in the state machine and which states are terminal.
>
> Our view sits beside the provider's, field by field, so a disagreement is
> visible rather than inferred.
>
> Underneath: the double-entry journal, and a hash-chained audit timeline where
> each entry commits to the one before it.

---

## 2:30 — 3:15 · Break it on purpose

**Screen** — Sidebar → **Failure injection**. Inject a **provider timeout**.
Then sidebar → **Exceptions**, and run reconciliation.

> Now the important part. I'm going to break it deliberately.
>
> This injects a provider timeout — we send the instruction and never learn the
> outcome. The payment goes to `UNKNOWN`. That is not a bug; it's the honest
> state. Money may or may not have moved, and claiming to know would be a lie.
>
> Reconciliation asks the provider what it believes, and repairs the state. If
> the provider has no record, it raises a `MISSING_EXTERNAL` case for a human
> instead of silently marking it confirmed.

**Screen** — Sidebar → **Trial balance**.

> And after all of that, the books still foot. Debits equal credits, to the
> paise.

---

## 3:15 — 4:20 · Track 04: the benchmark

**Screen** — Sidebar → **Track 04 benchmark**. Land on the Financial Safety
panel first — do not scroll past it.

> This is the Track 04 submission proper.
>
> Before any accuracy number: five safety counters. False resolutions.
> Duplicate payments let through. Unbalanced journals. Exceptions closed with
> no reason. Self-approved large payments. All zero — and each one says whether
> it was measured from the benchmark or from the live system, because a safety
> panel computed entirely from a simulation is a panel about a simulation.

**Screen** — Scroll to the headline figures, then the pipeline diagram.

> Five hundred and forty-six labelled finance records. Three hundred and
> sixty-seven held out — thresholds are tuned on the other hundred and
> seventy-nine only.
>
> Three hundred and sixty-seven correctly resolved. Sixty-two percent cleared
> automatically, thirty-eight percent escalated. Zero false resolutions.
>
> The architecture is deliberately visible: scoring produces a confidence, and
> a *deterministic policy engine* can veto a hundred-percent-confidence match.
> That's not decoration — a duplicate payment scores perfectly on every field,
> which is exactly what makes it a duplicate.

**Screen** — Scroll to the baseline table, then the exception list. Click one
exception to open the drill-down.

> Against a trivial exact-match rule: a hundred percent versus forty-seven,
> and the baseline lets sixty-three bad records through.
>
> Every escalation is clickable. Field by field: what matched, what differed,
> the weight each carried, the policy stage that blocked it — and the sentence
> that matters most in a finance system, *why this was not resolved
> automatically*.
>
> This one is short by one rupee eighty-nine on a sixteen-lakh invoice.
> Reference, bank identifier, date and beneficiary all agree. The amount
> tolerance is zero paise on purpose, because a tolerance wide enough to
> absorb this is wide enough to absorb a real loss at volume.

---

## 4:20 — 4:40 · Where it breaks, honestly

**Screen** — Scroll to the "What this score does and does not establish"
callout. Hold on it for a beat.

> And the page says what the score does *not* prove. I wrote both the dataset
> and the controller, so a hundred percent measures internal consistency — not
> accuracy on a real settlement file.
>
> So I attacked it. An adversarial set, built by reading the controller's own
> code and falsifying its assumptions, drops it to seventy-nine percent — and
> found a real hole: it was clearing payments to companies whose names differed
> only by a corporate suffix.
>
> Degrade the input data and the match rate falls by a third. False resolutions
> stay at zero on every rung. It degrades into *caution*, not into error.

---

## 4:40 — 5:00 · Proof, not claims

**Screen** — Switch to the terminal. Run these two, or show pre-scrolled
output:

```bash
npm run razorpay:check
npm run demo:verify
```

> Twelve checks against the live Razorpay test API — it creates a real order
> you can look up in the dashboard. That's how I found that Razorpay returns a
> four-hundred, not a four-oh-four, for a missing object — which meant
> reconciliation would have crashed on its most important finding. A mock could
> never have caught it, because the mock agreed with the code it stood in for.
>
> And forty-nine end-to-end invariants, which assert their own count — so a
> check can't silently stop running.
>
> Equilibrium: an AI finance controller that knows when to act, when to ask,
> and when not to guess.

---

## Timing budget

| Segment | Length | Cut priority |
|---|---|---|
| The problem | 0:35 | Keep |
| Supplier + explainability | 0:45 | Trim to 0:30 |
| Approve → effect | 0:40 | Keep |
| Payment end to end | 0:30 | Trim first |
| Break it → reconcile | 0:45 | **Never cut** |
| Track 04 benchmark | 1:05 | Keep |
| Adversarial + robustness | 0:20 | **Never cut** |
| Terminal proof | 0:20 | Trim to 0:10 |

Running total **5:00**. If you overrun, the two "trim first" rows buy you
thirty-five seconds without losing an argument.

---

## Numbers quoted, for checking

All verifiable by running the commands above.

| Claim | Value |
|---|---|
| Benchmark records / held out | 546 / 367 |
| Match rate (held out) | 100.0% |
| Auto-resolved / escalated | 61.9% / 38.1% |
| False resolutions | 0 |
| Exact-match baseline | 47.4%, 63 false resolutions |
| Adversarial set | 78.6% |
| Robustness floor | 66.8%, still 0 false resolutions |
| Razorpay live checks | 12 / 12 |
| Demo invariants | 49 |
| Unit tests | 250 |
| Published payment cycle | 73 days vs 30-day terms |

---

## If something breaks live

- **Empty dashboard** — `npm run db:seed`
- **Port 3000 busy** — `npm run dev -- -p 3001`
- **Track 04 page slow on first load** — it runs the benchmark on request;
  load it once before recording so Next has compiled the route
- **Razorpay check says "no credentials"** — credentials live in `.env.local`,
  which is gitignored; see [docs/RUNBOOK.md](docs/RUNBOOK.md)
