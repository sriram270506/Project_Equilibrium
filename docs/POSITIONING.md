# Who this is for, and what it competes with

The uncomfortable question first, because a reviewer who knows this market will
ask it in the first two minutes.

---

## TReDS already exists, and it is bigger than you think

The **Trade Receivables Discounting System** is RBI-licensed, operational since
2017, and discounted roughly **₹3.47 lakh crore in FY 2025-26** — up from
₹40,000 crore in FY22. Five platforms operate on it: RXIL, M1xchange,
Invoicemart, C2treds and DTX. Over 80,000 MSMEs are registered.

Any product doing receivables finance in India competes with this whether it
admits so or not.

### On price, we currently lose

TReDS discounts in roughly the **8–12% annualised** band. Rates are set by
auction against the **buyer's** credit, so a small supplier selling to a
blue-chip buyer gets a rate reflecting that buyer rather than themselves — a
genuinely good deal.

This demo prices at **16.2% annualised**. That is dearer, and
[`benchmarkRate()`](../src/lib/benchmark/market-data.ts) returns
`ABOVE_TREDS` and says so on the offer page. A pricing surface that always
reports "competitive" is one nobody checked.

**So the honest position is not "cheaper". It is "reachable".**

---

## Where TReDS does not reach

| | TReDS | Equilibrium |
|---|---|---|
| **Onboarding** | Both buyer and supplier must register on an RBI-licensed platform | Supplier already sells through the marketplace; nothing to join |
| **Mechanism** | Auction — financiers bid, and may not bid at all | Direct decision against the platform's own float |
| **Settlement** | T+1 or later | Seconds |
| **Minimum viable size** | Financiers bid on invoices worth bidding on | ₹96,000 invoice is fine |
| **Anchor requirement** | Works best with a large, rated buyer | Works with the marketplace as counterparty |
| **Coverage** | ~80,000 registered MSMEs | Every supplier already on the platform |

India has roughly **6.3 crore MSMEs**. 80,000 are on TReDS. The gap is not a
rounding error — it is the market.

The suppliers this serves are the ones for whom TReDS is theoretically
available and practically not: too small for a financier to bid on, selling to
a buyer nobody has rated, and needing the money this week rather than after an
onboarding cycle.

---

## The problem is measured, not asserted

**MSME Samadhaan** is the Government of India portal where a micro or small
enterprise files a formal complaint about a buyer who has not paid within the
statutory 45 days. It is the closest thing to a national measurement of exactly
this problem:

- **~2.18 lakh applications** filed since 2017
- **~₹22,363 crore** still pending as of 17 July 2025

Those are only the cases severe enough that a small business escalated to a
government council. The underlying delayed-payment volume is far larger.

The **MSMED Act 2006** makes this legally concrete:

- **§15** — a buyer must pay a registered micro or small enterprise within
  **45 days**
- **§16** — beyond that, compound interest at **three times the RBI bank rate**

Both are encoded as rules in
[`market-data.ts`](../src/lib/benchmark/market-data.ts), not as prose. Invoice
`inv_005` in the fixture set carries 90-day terms and is flagged as a statutory
breach with the interest quantified.

---

## Who deploys this, concretely

**The marketplace's finance team**, not the supplier and not the buyer.

A B2B marketplace already knows: which suppliers it owes, how much, when it is
due, and their transaction history. It usually holds float between collection
and payout. That combination is unusual — a lender has the capital but not the
data; the supplier has the need but no leverage.

The operator is an AP or treasury analyst who today approves payment runs on a
schedule. This changes their job from "pay everyone on day 45" to "pay these
three suppliers early because they will not survive to day 45, and it costs us
almost nothing to do so."

---

## Why this is a Razorpay product rather than a standalone one

The decision layer is not the hard part. Disbursing reliably is, and that is
infrastructure Razorpay already operates:

- **RazorpayX Payouts** with `X-Payout-Idempotency` — see
  [RAZORPAY_INTEGRATION.md](RAZORPAY_INTEGRATION.md)
- Signed webhooks with at-least-once delivery
- An asynchronous payout state machine that makes `UNKNOWN` a real state rather
  than a theoretical one

A marketplace building this alone would have to reimplement exactly-once
disbursement against whatever rails it could reach. Building it on Razorpay's
payout primitive means the exactly-once guarantee is the provider's, not a
hopeful client-side reimplementation.

---

## What would change this assessment

Stated so the argument can be attacked:

1. **If TReDS onboarding gets easy.** Mandatory TReDS for CPSE invoices is
   already expanding coverage. If registration becomes trivial, the access
   advantage narrows and this has to compete on price — which today it loses.
2. **If the unit economics do not close.** `npm run ml:ab` currently reports the
   model as **net negative** at the declared costs: ₹3,077 margin per advance
   against ₹4,923 for a wasted one, roughly 1.4 wasted for every one that
   lands. Better targeting or a higher discount is required, and a higher
   discount worsens the TReDS comparison. **This is unresolved.**
3. **If marketplaces will not take balance-sheet risk.** This assumes the
   platform funds advances from its own float. If they will not, the product
   becomes an origination layer for a third-party financier — a different
   business with different economics.

The first and third are strategy. The second is measurable, and the measurement
currently says the pricing does not work yet.

---

## Sources

- [MSME Samadhaan](https://samadhaan.msme.gov.in/) — delayed-payment applications and pending amounts
- [PIB: TReDS mandate for CPSEs](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2283195)
- [RXIL crosses ₹1 lakh crore](https://www.business-standard.com/content/specials/rxil-treds-surpasses-inr-1trillion-1-lakh-crore-in-invoice-financing-for-msmes-124051601663_1.html)
- MSMED Act 2006, sections 15 and 16
