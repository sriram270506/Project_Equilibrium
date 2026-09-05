# Track 04 — Finance operations

The finance-operations loop, the benchmark that scores it, and an honest
account of what the score does and does not establish.

```
Ingest → normalise → reconcile → auto-resolve safe matches → escalate exceptions → audit report
```

---

## Run it

```bash
npm run track04:benchmark
```

Prints the full report and exits non-zero if any record was cleared that
should have been escalated. Add `-- --record` to persist the run and open a
review row for each exception:

```bash
npm run track04:benchmark -- --record
```

In the console: **Track 04 benchmark** → *Run Track 04 evaluation*. The
dashboard computes on every page load; the button is what records a run.

---

## The golden result

Fixed seed, versioned dataset, versioned controller. These are the numbers a
reviewer should see, and any difference is a regression rather than noise.

| | |
|---|---|
| Dataset | `track04-dataset-1.2.0`, seed `20260904` |
| Controller | `track04-controller-1.0.0` |
| Total records | 546 (367 held-out, 179 tuning) |
| **Correctly resolved** | **367 / 367** |
| **Match rate** | **100.0%** |
| Auto-resolution rate | 61.9% |
| Exception rate | 38.1% |
| Auto-resolution precision | 100.0% |
| Escalation recall | 100.0% |
| **False resolutions** | **0** |
| Missed matches | 0 |
| Wrong exception type | 0 |
| Throughput | ~75,000 records/sec |
| Baseline (exact match) | 47.4% match rate, 63 false resolutions |

**Read the next section before quoting the match rate.**

---

## What this score does and does not establish

The dataset and the controller were written by the same author. A defect class
nobody thought to plant is a defect class the controller is not tested against,
and this benchmark cannot reveal that. **A high match rate here measures
internal consistency. It is not evidence of accuracy on a real settlement file
and should not be presented as such.**

Both splits are currently saturated at 100%, which means the tuning/held-out
comparison is not doing useful work right now. The split is still wired up and
will start discriminating again as harder cases are added. Claiming it proves
anything today would be the kind of unfalsifiable statement this document
exists to avoid.

What the run *does* establish:

- **Zero false resolutions** across 367 held-out records. That is the error
  class that costs money — a missed match costs an operator five minutes, a
  false resolution closes the book on a duplicate payment and nobody looks
  again.
- The controller **abstains** on every genuinely undecidable record instead of
  picking a candidate to improve its own numbers.
- It beats a trivial exact-match rule 100.0% to 47.4%, so the machinery earns
  its complexity.

### Evidence the benchmark has teeth

Building it exposed three real defects in the controller that were **not**
anticipated when it was written:

1. **Duplicate detection could never fire.** It required both candidates to
   clear the 90% auto-resolve bar, but a genuine double-send carries a
   different UTR, so the second settlement scores ~70%. Every duplicate and
   every ambiguous record — 23 in total — was auto-resolved against the first
   row. A structural fact was gated behind a threshold tuned for something
   else.
2. **The matcher never compared the beneficiary.** Ten payments made to a
   different company were cleared at 100% confidence, because on every field it
   bothered to look at, everything agreed.
3. **Split settlements** summing to the invoice were misread as amount
   mismatches.

All three are fixed. A benchmark that only ever confirms its author was right
is not measuring anything.

### What would make it materially stronger

- A real anonymised settlement file with known outcomes.
- A defect set authored by someone other than the controller's author.
- Live provider data, which needs the Razorpay test credentials this
  submission does not ship.

---

## The AI boundary

Which parts of this system are what. Presenting a deterministic check as AI is
the failure mode this table exists to prevent.

| Stage | Kind | What it actually is |
|---|---|---|
| Ingest | Deterministic | Reads the record pair. No inference. |
| Normalise reference / party | Deterministic | Case folding, separator stripping, a placeholder denylist, whole-word corporate-suffix removal. Pure string rules. |
| Structural checks | Deterministic | One side missing, no usable identifier, several settlements under one reference. Set logic. |
| Candidate scoring | **Statistical** | Weighted field agreement over reference, UTR, amount, value date and beneficiary, normalised to a 0–1 confidence. Weights are hand-set and tuned against the tuning split only. |
| Policy gates | Deterministic | Counterparty, amount, status, tax, confidence floor. Can veto a 100%-confidence match. |
| Human review | **Person** | Accept, reject, relink, mark duplicate, freeze. Every action attributed and timestamped; a note is mandatory for everything except plain acceptance. |
| Ledger and audit | Deterministic | Double-entry posting and the hash-chained audit log. |

**There is no LLM anywhere in this path.** Calling a weighted-sum matcher "AI"
would be exactly the claim this project exists to avoid. What makes it worth
showing is not that it is clever — it is that it abstains, explains every
refusal, prices its own errors, and is measured on held-out data.

The separate **liquidity model** (`/dashboard/model`) *is* a fitted logistic
regression, with its own AUC, permutation controls and model card. That is a
different system answering a different question, and its AUC is **not** the
Track 04 accuracy metric.

---

## The dataset

546 reconciliation subjects. Each is an internal record (what we believe
happened) against zero or more external provider records (what the provider
says happened), plus a ground-truth label and the action a correct system
should take.

| Label | Count | Expected action |
|---|---|---|
| `MATCHED` | 340 | Auto-resolve |
| `AMOUNT_MISMATCH` | 40 | Escalate |
| `STATUS_MISMATCH` | 30 | Escalate |
| `MISSING_EXTERNAL` | 30 | Escalate |
| `DUPLICATE` | 25 | Escalate |
| `MISSING_INTERNAL` | 20 | Escalate |
| `TAX_MISMATCH` | 15 | Escalate |
| `COUNTERPARTY_MISMATCH` | 14 | Escalate |
| `INVALID_REFERENCE` | 12 | Escalate |
| `PARTIAL_SETTLEMENT` | 12 | Escalate |
| `AMBIGUOUS` | 8 | Escalate |

Difficulty tiers — `EASY`, `MEDIUM`, `HARD`, `AMBIGUOUS` — are reported
separately, because an aggregate over a dataset that is mostly trivial says
nothing about the cases that cost money.

Amounts are drawn from the MSME turnover distribution calibrated to published
Indian data (see [`population-calibration.ts`](../src/lib/benchmark/population-calibration.ts)),
truncated rather than clipped so the lognormal shape survives. An earlier
version clipped at ₹8 lakh and put 12.8% of records on exactly that figure — a
visible spike in a dataset whose claim is that its amounts follow a real
distribution.

### Splits

Stratified by label, so all eight `AMBIGUOUS` records cannot land on one side.
Thresholds are tuned against `TUNING` only; every headline number is reported
on `HELD_OUT`.

---

## Reproducibility

| | |
|---|---|
| Seed | `DATASET_SEED = 20260904` |
| Dataset version | `DATASET_VERSION` in `src/lib/track04/dataset.ts` |
| Controller version | `CONTROLLER_VERSION` in `src/lib/track04/controller.ts` |
| Size assertion | `buildDataset` throws if the composition does not sum to `DATASET_SIZE` |
| Determinism test | `controller.test.ts` asserts two builds are byte-identical, and that a different seed produces different data |

Every recorded run stores both versions alongside its metrics. That is the
point of the [run history](../app/dashboard/track04/history/page.tsx): a match
rate on its own cannot tell you whether a fall came from the data or the code.

---

## The exception list

Every record the controller will not clear appears with a record id, exception
type, amount, confidence, the reason, a recommended action, and — the part that
matters for a finance system — **why it was not resolved automatically**.

Example:

> **`rec_0522` · COUNTERPARTY_MISMATCH · ₹8,00,000 · 83% confidence**
>
> Instructed to Saffron Retail Supply; the provider paid Orbit Kitchenware.
>
> *Why not auto-resolved:* Reference, amount, date and bank identifier all
> agree — which is exactly why this needs a human. Every field except the
> beneficiary says the record is correct, so a matcher that does not compare
> the counterparty clears it with full confidence.
>
> *Recommended action:* Stop any further payments to this beneficiary and raise
> a recall with the provider. Confirm the mandate before re-instructing.

Exceptions are worked in the [review queue](../app/dashboard/track04/review/page.tsx).
The controller cannot close them — an exception it could close would not have
been an exception.

---

## Ledger correctness

The benchmark posts no journals; it is a matching exercise, not a payment run.
A "ledger imbalance" computed from it would be zero by construction and would
mean nothing, so the figure reported alongside the benchmark is read from the
**live** trial balance instead, and labelled as such. A metric that cannot fail
is not a metric.

---

## Related

- [SCOPE.md](SCOPE.md) — what is real and what is simulated across the system
- [RUNBOOK.md](RUNBOOK.md) — operating and recovering the app
- [RAZORPAY_INTEGRATION.md](RAZORPAY_INTEGRATION.md) — provider surface and what is exercised
