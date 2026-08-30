# Equilibrium — 2-Minute Demo Script

**Duration**: 2 minutes  
**Audience**: Technical decision-makers, fintech engineers  
**Goal**: Show how bounded intelligence + policy controls = safer payment operations

---

## [0:00-0:20] Problem Statement

"In marketplace lending, we ask: Should we offer early payment to this supplier?

Every decision has tradeoffs:
- **Too conservative**: Miss revenue opportunities
- **Too aggressive**: Risk bad debts and financial loss

Equilibrium shows how to make these decisions *safely*.

Let me show you..."

*(Open browser, navigate to localhost:3000)*

---

## [0:20-0:45] The Recommendation

"Here's Aarav Industrial Components. Our system analyzed their cash flow for 30 days:

- Volatility is elevated (unpredictable incoming cash)
- Runway is low (only 2-3 days of operating capital)
- They've been with us 1,250 days (trustworthy tenure)

Our ML model says: 78% probability they'll need liquidity within 7 days."

*(Click Opportunities → Aarav → View Details)*

**Show**:
- Model probability: 78%
- Expected benefit: ₹1,500 (what we save by preventing customer churn)
- Policy decision: **Approved** (hard caps are within limits)

---

## [0:45-1:15] Safe Approval & Execution

"The finance team reviews this recommendation and approves it. Watch what happens internally:

1. We create a **payment intent** (immutable record)
2. We book the **ledger** (balanced debit/credit)
3. We send to **the provider** (Razorpay)
4. The provider confirms (**CONFIRMED** status)"

*(Click Approve Opportunity → confirm)*

**Show**:
- Payment created with correlation ID
- Redirect to Payment Operations
- Status: `SUBMITTED` → `CONFIRMED`
- Ledger entries: Debit PLATFORM_CASH, Credit SUPPLIER_PAYABLE (₹1,500)

---

## [1:15-1:40] The Safety: Reconciliation

"Now here's where **Equilibrium gets interesting**.

What if the provider said 'yes' but our client timed out? We'd have ₹1,500 pending forever.

Watch what reconciliation does..."

*(Click Reconciliation → Run Reconciliation)*

**Show**:
- "Matched" outcome appears
- Internal vs. External: Both confirmed, amounts equal
- Case resolved automatically

"Reconciliation compared our internal record against the provider's record.

If there was an **amount mismatch** or **status mismatch**, it would flag it for manual review—never silently fix the books."

---

## [1:40-2:00] The Boundaries

"Equilibrium shows what's possible with fintech operational controls. But it's a prototype.

*(Navigate to Scope & Controls)*

**Demonstrated:**
- ML predictions
- Hard policy caps
- Safe provider integration
- Balanced accounting
- Reconciliation & mismatch detection

**Designed but not implemented:**
- Live Razorpay adapter
- Multi-tenant isolation
- Full KYC/AML
- Escrow operations

**Not in scope:**
- Production compliance
- Real customer data
- Real money settlement

**The point**: We've proven the architecture. The business logic is sound. The controls work. Now you'd add the compliance layer for production."

---

## [2:00] Close

"Equilibrium is bounded intelligence in action:

- **ML makes recommendations** (not decisions)
- **Policy enforces hard limits** (cannot be overridden)
- **Humans approve** (final authority)
- **Reconciliation detects problems** (before they become losses)

That's how you build safer payment operations.

Questions?"

---

## Optional Deep-Dives

### If Asked: "How does it handle timeouts?"

"Good question. Show the UNKNOWN state:

In the mock provider, we can simulate a timeout *after* the provider confirms. Internally, we get `UNKNOWN`. We don't mark it failed—we mark it ambiguous.

Then reconciliation resolves it: 'Provider says CONFIRMED, we say UNKNOWN → update to CONFIRMED.'"

### If Asked: "What about fraud?"

"Equilibrium doesn't do fraud detection. But the architecture supports it:

Each decision is versioned (model version, policy version, feature snapshot). You could audit 'why did we approve this?'

And reconciliation would catch patterns like 'we always approve, provider always declines.'"

### If Asked: "How does it scale?"

"In the demo, it's SQLite. For production:

- Postgres replaces SQLite
- Redis Streams replaces the local event log
- Background workers publish events
- Everything else stays the same—we designed for this"

---

## Talking Points to Memorize

1. **Integer arithmetic only**: All amounts in paise (no floating-point errors)
2. **Double-entry ledger**: Every debit has a matching credit (auditable)
3. **Idempotency**: Same request twice = same result (no double-payments)
4. **UNKNOWN is real**: Timeouts don't disappear; reconciliation resolves them
5. **Policy is hard**: Model confidence can't override spending caps
6. **Immutable audit trail**: Every decision is logged with correlation ID
7. **No silent repairs**: Reconciliation flags mismatches, doesn't fix them
8. **Designed for production**: MockRazorpay → Real Razorpay is a swap

---

## Demo Troubleshooting

| Issue | Solution |
|-------|----------|
| Page won't load | Run `npm run dev` in Terminal |
| "Aarav" not showing | Reset demo: `curl -X POST http://localhost:3000/api/demo/reset -H "Content-Type: application/json" -d '{"confirm":true}'` |
| Approval fails | Check console for error; refresh and try again |
| Reconciliation empty | Click "Run Reconciliation" button first |

---

## Follow-Up Conversation Starters

- "How would you integrate with a real Account Aggregator?"
- "What would KYC/AML integration look like?"
- "How do you handle multi-currency settlements?"
- "What's the dispute evidence workflow for chargebacks?"
- "How would you version migrations in production?"

---

**Remember**: You're not selling the product. You're showing the *thinking* behind safe fintech systems.

Good luck! 🚀
