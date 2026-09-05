# Failure recovery

What broke, what it actually was, and what changed so it cannot break the same
way twice.

Every entry here is a real defect that reached a running system. None of them
were found by reading code. They were found by running the thing, measuring it,
or pointing it at something that answers back — and the pattern that connects
almost all of them is that **the failure was silent**: a check that stopped
running, a metric that could not fail, a mock that agreed with the code it was
standing in for.

---

## 1. The model was confidently backwards

**Symptom.** Every supplier scored 99% risk of running out of cash. The
dashboard flagged the entire book as distressed, which is the same as flagging
nothing.

**Cause.** The liquidity features were hand-specified, and one was
double-negated: `daysRunwayTrend: -daysRunway` carried a coefficient of `-3.5`.
Two negatives meant *more* cash runway predicted *more* distress. Nothing about
the code looked wrong — it was arithmetically consistent and completely
inverted.

**Fix.** The coefficients are no longer written by hand. `npm run ml:train`
fits a logistic regression on a train/test split and prints held-out metrics.
A fitted model cannot learn a sign that contradicts its own data.

**What generalises.** Hand-written model weights cannot be evaluated, so
"we used machine learning" becomes an unfalsifiable claim. The demo verifier
now asserts the *sign* of two coefficients directly: cash coverage must lower
predicted risk, runway pressure must raise it.

---

## 2. Policy and model disagreed about what a threshold meant

**Symptom.** Suppliers the model scored as distressed were rejected by policy.

**Cause.** The policy hardcoded an action threshold of `0.5`. The model had
been calibrated, by recall-weighted F-beta search, to `0.15`. Two numbers, two
files, one concept.

**Fix.** Policy reads `APPROVAL_THRESHOLD` from the model artifact. The number
exists once.

---

## 3. A payment could be lost between us and the provider

**Symptom.** None. This one was never observed — it was found by reading the
state machine after an unrelated failure.

**Cause.** `submitPaymentToProvider` moved a payment straight from
`INTENT_CREATED` to `CONFIRMED`. If the process died during the provider call,
the payment was recorded as never having been sent, while the provider may
well have executed it. Re-running would pay twice.

**Fix.** `SUBMITTED` is written **before** the provider call. A crash now
leaves the payment in a state that reconciliation knows to resolve, rather than
one that invites a duplicate.

---

## 4. The mock erased the failure it was supposed to inject

**Symptom.** Injected provider failures did nothing. The demo's "break it on
purpose" page reported success every time.

**Cause.** `MockRazorpay` reset `this.failureMode = "success"` before building
its result, so the branch that produced the failure read the already-cleared
value.

**Fix.** The active mode is captured into a local before the reset. A test
asserts an injected timeout actually produces `UNKNOWN`.

---

## 5. Two verifier checks silently stopped running

**Symptom.** An earlier `npm run demo:verify` run printed **48 passed, 0 failed**. It had
printed 48 before. Nothing was red.

**Cause.** The population recalibration moved every offer above the
dual-approval threshold. The happy-path step picked "the smallest recommended
offer" and got one that required a second approver, so it stopped at
`PENDING_APPROVAL` and never paid anything — which meant no webhook was ever
delivered, and the two webhook-replay checks below simply never executed.

A check that stops running does not fail. It disappears, and the total quietly
shrinks.

Worse, the step that should have caught it was written as:

```ts
check(
  "Payment reached a terminal success state",
  status === "CONFIRMED" || approval.requiresDualApproval,
  `status ${status}`
);
```

That escape hatch made it pass while printing `status PENDING_APPROVAL` — a
check named "reached a terminal success state" passing on a state that is
neither terminal nor a success.

**Fix.** Three things:

1. The escape hatch is gone. The happy path explicitly selects a
   *sub-threshold* offer and asserts one exists.
2. The verifier declares `DECLARED_CHECK_COUNT` and **asserts its own total**.
   Adding or removing a check fails the run until the constant is updated.
3. Verified by setting the constant wrong on purpose — it exits 1 and names
   the drift.

**What generalises.** A passing test suite is evidence only if you also know
how many tests ran. Three documents in this repo had quoted three different
check counts (48, 39, 28) precisely because the number lived in prose.

---

## 6. The benchmark's most expensive gate could never fire

**Symptom.** The Track 04 benchmark reported **23 false resolutions** — every
duplicate settlement and every ambiguous record auto-resolved against the first
candidate.

**Cause.** Duplicate detection required *both* candidates to clear the 90%
auto-resolve threshold. A genuine double-send carries a different bank
reference, so the second settlement scores about 70%. The gate saw one strong
candidate and passed.

A structural fact — *there are two settlements for one instruction* — had been
gated behind a confidence threshold tuned for an unrelated purpose.

**Fix.** Duplicate and split-settlement detection now run on the candidate
*floor*, before scoring decides anything, because they are set logic rather
than a question of confidence.

---

## 7. The matcher never checked who was paid

**Symptom.** The adversarial set cleared **12 payments made to a different
company**, at 100% confidence.

**Cause.** The controller compared reference, amount, value date and bank
identifier. It did not compare the beneficiary. On every field it looked at,
everything agreed.

Then, after the beneficiary check was added, the adversarial set broke it
again: `normaliseParty` stripped `PVT`, `LTD` and `CORP` before comparing, so
*Orbit Kitchenware Ltd* and *Orbit Kitchenware Pvt Ltd* — two separately
registered companies — normalised to the same string.

**Fix.** Party comparison is conservative and three-valued: `AGREE` only on an
exact match after folding case and punctuation, `ABSENT` when the field is
empty, `DIFFER` otherwise. A corporate suffix is part of a legal identity, not
noise on a name.

The cost was accepted deliberately: an abbreviated trading name now escalates
instead of clearing. Over-escalating costs an operator a minute. Asserting two
names are the same company on a fuzzy basis is how money reaches the wrong
account.

---

## 8. The live provider disagreed with the mock, and the mock was wrong

**Symptom.** `npm run razorpay:check` crashed at step 5, against the real
Razorpay test API.

**Cause.** The adapter treated a missing provider object as HTTP `404` — which
is what REST convention says, and what `MockRazorpay` returned. Razorpay does
not do that. A well-formed but absent order id comes back as:

```
400 BAD_REQUEST_ERROR   "The id provided does not exist"
```

So `getOperation` **threw** on precisely the case reconciliation exists to
detect — a payment the provider has no record of — instead of returning null
and raising `MISSING_EXTERNAL`. Reconciliation would have crashed on its most
important finding.

**The mock could not have caught this.** It was written to the same assumption
as the adapter it was standing in for. Only talking to the real API found it.

**Fix.** The absent case keys on the error *description*, not the status code,
because a **malformed** id also returns 400 with `"... is not a valid id"`.
That one must keep throwing: reporting a mistyped reference as "the provider
has no record" would turn our own bug into a finding about someone else.

Five tests now pin the distinction.

---

## 9. A run row that lied about its own contents

**Symptom.** The benchmark history showed a run claiming **140 exceptions,
0 stored**.

**Cause.** The run row and its exception rows were two separate writes. A
failure between them left a row that misreports itself — which is worse than
no row, because it looks like a clean run with nothing to review.

**Fix.** One transaction. The exception count and the exceptions are the same
fact recorded twice; they commit together or not at all.

---

## 10. Money overflowed a 32-bit column

**Symptom.** The first recorded benchmark run failed on write:

```
Value 4805212772 does not fit in an INT column
```

**Cause.** ₹4.8 crore in paise exceeds `Int32`. Per-payment columns are fine —
a single advance cannot approach it — but these were aggregates over hundreds
of records.

**Fix.** `BigInt` for the aggregate money columns, `Int` retained where the
value is bounded by a per-transaction cap. Converted to `Number` at the JSON
boundary, where the values sit far below `MAX_SAFE_INTEGER`.

---

## 11. A safety metric that could not fail

**Symptom.** The Financial Safety panel read **"Unbalanced journals: 0"** with
the explanation *"every one of 0 ledger transactions checked"*.

**Cause.** The database was empty. A green zero, presented as a passing result,
computed from nothing.

**Fix.** The counter now says plainly that nothing has been tested yet. Four
tests feed deliberately corrupted ground truth in and assert the counters
*do* fire — because a panel of zeros only means something if the zeros could
have been otherwise.

---

## 12. A calibration that was arithmetically wrong

**Symptom.** The simulated supplier population reported an average payment
cycle of **98.6 days** against a published Indian figure of 73.

**Cause.** Collection efficiency had been anchored at `30/73 = 0.411` — terms
divided by realised days, which reads as obviously correct. It is not.
Days = terms / efficiency is *convex* in efficiency, so by Jensen's inequality
`E[terms/p] > terms/E[p]`. Centring the distribution on the naive ratio
overshoots by nearly a month.

**Fix.** Solved properly and in closed form, from `E[1/p] = (k-1)/(mk-1)` for a
Beta distribution. The population self-check catches this class of error on
every training run — it is what caught this one.

---

## 13. Two polls, one cursor

**Symptom.** The console logged *"Encountered two children with the same key"*
nine times on the overview.

**Cause.** The activity feed polls every four seconds. Two polls were in flight
at once; both read the same `since` cursor before either advanced it, both
fetched the same rows, and both prepended them. React's StrictMode double
effect invocation makes this fire on every mount in development, but it is a
genuine race in production: any response slower than the interval overlaps the
next tick.

Hiding in the same three lines was a second defect nobody had noticed —
`incoming.reverse()` was called **inside** the state updater, mutating the
response array from a function React treats as pure and may invoke more than
once. A second invocation reverses it again and puts the feed in the wrong
order. That would only ever have surfaced as *"the activity list is sometimes
upside down"*.

**Fix.** An in-flight guard so overlapping polls do not happen, *and* a merge
that deduplicates by audit sequence so a duplicate cannot be produced even if
one does. Correctness should not depend on the caller behaving — the next
person to add a refresh button would have reintroduced it.

---

## 14. A contrast token measured against the wrong surface

**Symptom.** After the interface moved from a dark canvas to paper, a live DOM
audit found **78 contrast failures**.

**Causes, three distinct ones.**

- `text-brand-bright` (#3395FF) was the colour of every link, and measures
  **3.02:1** on paper. It is a *fill* colour.
- `--ink-faint` had been set from its ratio against the **canvas** (4.9:1). Most
  faint text sits on **sunken** paper — table rows, event lists — where the same
  colour measured **3.91:1**. Sampling the wrong background is how a theme ends
  up technically compliant and actually unreadable.
- `.display` and `.figure` hard-coded an ink colour. That rendered the wordmark
  near-black on the navy sidebar at **1.19:1**, and silently overrode the tone
  classes on every dashboard figure, so all the status colouring the component
  computed was dead on arrival.

**Fix.** Typography classes own family, weight and figures; the caller owns
colour. Audit re-run to **0 failures**, with an alpha-compositing measurement
rather than a nearest-opaque-ancestor guess.

---

## The pattern

Ten of these fourteen were **silent**. They did not throw, did not fail a test,
and did not look wrong on the page:

| How it was found | Count |
|---|---|
| Running the system and measuring the output | 5 |
| Pointing it at something that answers back (the live API, a browser) | 4 |
| A self-check written specifically to catch this class | 3 |
| Reading the code | 2 |

The two found by reading were the cheapest to fix and the least likely to have
mattered. Everything expensive came from execution.

That is why this repository carries three things that are unusual for a
prototype:

1. **`npm run demo:verify`** — 49 invariants that assert their own count, so a
   check cannot vanish without the run failing.
2. **`npm run track04:benchmark`** — a labelled dataset with an adversarial set
   built by attacking the controller's own assumptions, and a robustness ladder
   that degrades the input until the match rate falls by a third. False
   resolutions stay at zero on every rung. A finance system may degrade into
   caution; it may not degrade into error.
3. **`npm run razorpay:check`** — 12 checks against the live Razorpay test API,
   because a mock agrees with whoever wrote it.

---

## Related

- [RUNBOOK.md](RUNBOOK.md) — operating and recovering the running system
- [TRACK04.md](TRACK04.md) — the benchmark, and what its score does not establish
- [SCOPE.md](SCOPE.md) — what is real, what is simulated, what is not built
