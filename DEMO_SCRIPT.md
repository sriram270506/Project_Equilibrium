# Five-minute demo script

Shot-by-shot for the submission video. Timings are targets, not a straitjacket —
the two things that must survive any cut are **the problem** (0:00–0:35) and
**the timeout surviving reconciliation** (2:20–3:30).

**Before recording**

```bash
npm run db:seed     # 6 suppliers, 30 days of history each
npm run dev
```

Then open <http://localhost:3000> and, on `/dashboard/demo`, click **Clear** so
the walkthrough starts unrun. Record at 1440×900 or wider.

---

## 0:00 – 0:35 · The problem

**Screen:** the landing page, top of the hero.

> "A supplier delivers goods on Monday and gets paid thirty days later. Payroll
> is on Friday. That gap kills otherwise-healthy businesses, and it's the
> single biggest cause of MSME failure in India."

**Scroll to the concrete case.**

> "Aarav Industrial Components is owed one lakh fifty thousand rupees, due in
> twenty-seven days. At their current burn rate they run out of cash in two and
> a half days. They aren't insolvent — they're illiquid. That's a fixable
> problem."

**Point at the three cards.**

> "Their alternative is borrowing at twenty-four percent. Equilibrium pays them
> one lakh forty-eight thousand two hundred today. The platform earns eighteen
> hundred rupees on cash it was holding idle. Both sides are better off."

---

## 0:35 – 1:05 · Why it's hard

**Screen:** scroll to "Deciding to pay is easy."

> "Deciding to pay is the easy part. The engineering problem starts the moment
> real money moves — a provider times out after the money's already gone, a
> webhook arrives twice, our books and the provider's disagree by two rupees.
> Every one of those has to be survivable, and provably so."

Let the six guarantees sit on screen for a beat. Don't read them all.

---

## 1:05 – 1:50 · The decision, explained

**Screen:** `/dashboard/opportunities` → open the highest-risk supplier.

> "The model flags Kaveri Logistics at sixty-four percent risk of a shortfall
> inside a week."

**Point at the runway chart.**

> "Thirty days of cash runway, sliding from twelve days to under two. That
> dotted line is one week of cover."

**Point at the explanation panel.**

> "And here's *why*. These aren't approximations — a logistic regression is
> additive in log-odds, so every prediction decomposes into exact per-feature
> contributions. Cash runway is the biggest driver, then unreliable customer
> payments. Cash on hand pulls the other way."

**Point at the counterfactual.**

> "It even tells you what would change the answer: at ten days of runway
> instead of one point seven, we wouldn't make an offer at all."

**Point at the deal card.**

> "And the price, in rupees. One-point-two percent sounds small — annualized
> it's sixteen point two percent. We show that next to the headline everywhere,
> because quoting only the headline is how suppliers get quietly overcharged."

---

## 1:50 – 2:20 · Approve, and the controls that fire

**Screen:** click **Approve and pay**.

> "One database transaction writes the payment intent, balanced double-entry
> ledger rows, a hash-chained audit record, and the outbox event. All of it
> commits together or none of it does."

**When the maker-checker banner appears** (it will, above ₹75,000):

> "This one's above the dual-approval threshold, so it's held. The operator who
> raised it *cannot* release it — that's enforced in the service, not the
> interface. A second approver has to sign it off."

Click **Approve as second operator**.

---

## 2:20 – 3:30 · Break it on purpose

**Screen:** `/dashboard/failures`.

> "Every payments system claims to survive these. Let's actually check."

Click **Inject** on *Timeout after the money left*.

> "The provider committed the payment, then the connection died before we heard
> back. Watch what we record: UNKNOWN. Not success, not failure. We genuinely
> don't know, and guessing either way is how you either pay twice or lose the
> money."

**Point at `ledgerBalanced: yes`.**

> "Books still foot."

Click **Inject** on *Webhook delivered twice*.

> "Providers guarantee at-least-once delivery, never exactly-once. Second
> delivery: zero net new event records. Deduplicated on the provider's event
> id."

---

## 3:30 – 4:10 · Resolve the unknown

**Screen:** `/dashboard/reconciliation`. Click **Run reconciliation**.

> "Reconciliation asks the provider what it believes and compares field by
> field."

**Open the resolved case, point at the three columns.**

> "Our books said UNKNOWN. The provider said CONFIRMED. It only repairs in the
> one direction that's provably safe — adopting a confirmation for a payment we
> couldn't classify. Anything else becomes an exception for a human. It never
> guesses."

---

## 4:10 – 4:45 · Prove nothing was lost

**Screen:** `/dashboard/ledger`.

> "After two deliberately broken payments: total debits equal total credits,
> difference zero."

**Screen:** `/dashboard/controls`, scroll to the audit chain.

> "The audit log is a hash chain. Let me tamper with it."

Click **Tamper with a record**.

> "I've just edited a historical row directly in the database, the way someone
> covering their tracks would. The chain immediately says which entry, and how:
> 'entry two has been modified since it was written.' Silent edits are
> impossible."

**Optional, if time:** click **Halt all payments**, show the banner.

> "And one switch stops everything, without a deploy."

---

## 4:45 – 5:00 · Close

**Screen:** terminal. Run:

```bash
npm run demo:verify
```

> "Everything I just showed you is asserted by one command — twenty-eight
> checks, end to end, exiting non-zero if any of them fails. Nothing in this
> project is a claim you have to take on trust."

Let the `28 passed, 0 failed` land. End.

---

## If you only have three minutes

Cut sections 2 (why it's hard) and the dispute workspace entirely. Keep:
problem → explanation → timeout → reconciliation → trial balance → verify.

## Things worth saying if a judge asks

- **"Why logistic regression and not a neural net?"** Because it's additive in
  log-odds, every prediction decomposes exactly, and the explanation shown to
  the operator *is* the model rather than an approximation of it. For something
  that moves money and must be explainable to an auditor, that beats a few
  points of accuracy.
- **"Is the model any good?"** AUC 0.959 against a 0.940 baseline, recall 95%,
  precision roughly double the naive rule. Threshold is 0.16, not 0.50, chosen
  by cost asymmetry — missing a distressed supplier costs far more than an
  unnecessary offer. All of it on the model card, all reproducible with
  `npm run ml:train`.
- **"What's not real?"** Synthetic data, mock provider, SQLite, API-key auth
  with a demo fallback, outbox drained by an endpoint rather than a worker.
  Listed in the README under Honest limitations.
