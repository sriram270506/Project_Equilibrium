import { PageHeader } from "@/src/components/ui/primitives";

export default function ScopePage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Scope and controls"
        lede="What is real, what is simulated, and what this deliberately does not do."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-ok/[0.10] border border-ok/30 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-ok mb-3">✓ Demonstrated</h2>
          <ul className="text-sm text-emerald-800 space-y-2">
            <li>• ML-assisted liquidity prediction (logistic model)</li>
            <li>• Economic policy evaluation with hard caps</li>
            <li>• Safe discount payout workflow</li>
            <li>• Provider adapter pattern (MockRazorpay)</li>
            <li>• UNKNOWN state handling (timeout resilience)</li>
            <li>• Reconciliation (internal vs external)</li>
            <li>• Idempotency & duplicate webhook detection</li>
            <li>• Balanced double-entry ledger</li>
            <li>• Audit event logging</li>
            <li>• Dispute evidence validation</li>
            <li>• Server-side provider integration</li>
          </ul>
        </div>

        <div className="bg-warn/[0.10] border border-warn/30 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-warn mb-3">⏳ Designed Not Implemented</h2>
          <ul className="text-sm text-amber-800 space-y-2">
            <li>• Full Account Aggregator integration</li>
            <li>• Live Razorpay adapter (test mode only)</li>
            <li>• Multi-currency support</li>
            <li>• Automated dispute submission</li>
            <li>• Escrow module</li>
            <li>• Real-time webhooks from provider</li>
            <li>• Background worker (outbox publisher)</li>
            <li>• Redis Streams event transport</li>
            <li>• Advanced role-based access control</li>
            <li>• Tenant isolation</li>
          </ul>
        </div>

        <div className="bg-paper-sunken border border-rule rounded-lg p-6">
          <h2 className="text-lg font-semibold text-ink-strong mb-3">🚫 Out of Scope</h2>
          <ul className="text-sm text-ink-body space-y-2">
            <li>• Production PCI-DSS compliance</li>
            <li>• DPDP (India Privacy Law) certification</li>
            <li>• Account Aggregator certification</li>
            <li>• Live customer data</li>
            <li>• Real payments to actual accounts</li>
            <li>• Full KYC/AML integration</li>
            <li>• Real ACID transaction isolation</li>
            <li>• Formal threat model assessment</li>
            <li>• Security audit</li>
            <li>• Performance testing at scale</li>
          </ul>
        </div>
      </div>

      <div className="glass  rounded-card p-8 mb-8">
        <h2 className="text-2xl font-bold mb-6">Architecture Principles</h2>
        
        <div className="space-y-8">
          <section>
            <h3 className="text-lg font-semibold text-ink-strong mb-3">
              Single Source of Truth
            </h3>
            <ul className="text-ink-body space-y-2">
              <li>
                <strong>Razorpay/Provider:</strong> Authoritative for live payment state
              </li>
              <li>
                <strong>Internal Database (Prisma/SQLite):</strong> Authoritative for business logic
              </li>
              <li>
                <strong>Event Log:</strong> Durable transport and replay mechanism (not authority)
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-ink-strong mb-3">
              Financial Correctness Rules
            </h3>
            <ul className="text-ink-body space-y-2">
              <li>✓ All monetary amounts are integer paise (no floats)</li>
              <li>✓ Every debit has a corresponding credit (double-entry)</li>
              <li>✓ Ledger entries are append-only, never updated</li>
              <li>✓ Server-side idempotency prevents duplicate payments</li>
              <li>✓ UNKNOWN state is terminal until reconciliation resolves it</li>
              <li>✓ Policy hard caps cannot be overridden by high probability</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-ink-strong mb-3">
              Resilience Patterns
            </h3>
            <ul className="text-ink-body space-y-2">
              <li>• <strong>Timeout After Remote Success:</strong> Payment confirmed at provider but timed out locally → UNKNOWN → Reconciliation repairs</li>
              <li>• <strong>Duplicate Webhook:</strong> Webhook re-sent or duplicated → Idempotency key prevents double booking</li>
              <li>• <strong>Missing Internal Record:</strong> Reconciliation detects orphaned provider payment</li>
              <li>• <strong>Amount Mismatch:</strong> Reconciliation halts and creates manual review case</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-ink-strong mb-3">
              Demo Data
            </h3>
            <p className="text-ink-body mb-3">
              All data is synthetic Indian marketplace suppliers. No real people, real bank accounts, or production credentials.
            </p>
            <ul className="text-ink-body space-y-2">
              <li>• 6 suppliers with varying risk tiers</li>
              <li>• 30 days of liquidity observations</li>
              <li>• 2 opportunity examples (recommended & approved)</li>
              <li>• 1 confirmed payment with reconciliation</li>
              <li>• 2 dispute cases (complete & contradictory evidence)</li>
            </ul>
          </section>
        </div>
      </div>

      <div className="bg-danger/[0.10] border border-danger/30 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-danger mb-3">⚠️ Important Disclaimer</h2>
        <p className="text-sm text-danger">
          This is a <strong>Razorpay Buildathon prototype</strong> for demonstration purposes only.
          It is <strong>not production-ready</strong> and does not meet compliance requirements for real financial operations.
          Do not use with real customer data, real payments, or in production environments.
        </p>
      </div>
    </div>
  );
}
