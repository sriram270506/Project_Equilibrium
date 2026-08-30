export default function ScopePage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Scope & Controls</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-emerald-900 mb-3">✓ Demonstrated</h2>
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

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-amber-900 mb-3">⏳ Designed Not Implemented</h2>
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

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">🚫 Out of Scope</h2>
          <ul className="text-sm text-slate-700 space-y-2">
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

      <div className="bg-white rounded-lg shadow p-8 mb-8">
        <h2 className="text-2xl font-bold mb-6">Architecture Principles</h2>
        
        <div className="space-y-8">
          <section>
            <h3 className="text-lg font-semibold text-slate-900 mb-3">
              Single Source of Truth
            </h3>
            <ul className="text-slate-700 space-y-2">
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
            <h3 className="text-lg font-semibold text-slate-900 mb-3">
              Financial Correctness Rules
            </h3>
            <ul className="text-slate-700 space-y-2">
              <li>✓ All monetary amounts are integer paise (no floats)</li>
              <li>✓ Every debit has a corresponding credit (double-entry)</li>
              <li>✓ Ledger entries are append-only, never updated</li>
              <li>✓ Server-side idempotency prevents duplicate payments</li>
              <li>✓ UNKNOWN state is terminal until reconciliation resolves it</li>
              <li>✓ Policy hard caps cannot be overridden by high probability</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900 mb-3">
              Resilience Patterns
            </h3>
            <ul className="text-slate-700 space-y-2">
              <li>• <strong>Timeout After Remote Success:</strong> Payment confirmed at provider but timed out locally → UNKNOWN → Reconciliation repairs</li>
              <li>• <strong>Duplicate Webhook:</strong> Webhook re-sent or duplicated → Idempotency key prevents double booking</li>
              <li>• <strong>Missing Internal Record:</strong> Reconciliation detects orphaned provider payment</li>
              <li>• <strong>Amount Mismatch:</strong> Reconciliation halts and creates manual review case</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900 mb-3">
              Demo Data
            </h3>
            <p className="text-slate-700 mb-3">
              All data is synthetic Indian marketplace suppliers. No real people, real bank accounts, or production credentials.
            </p>
            <ul className="text-slate-700 space-y-2">
              <li>• 6 suppliers with varying risk tiers</li>
              <li>• 30 days of liquidity observations</li>
              <li>• 2 opportunity examples (recommended & approved)</li>
              <li>• 1 confirmed payment with reconciliation</li>
              <li>• 2 dispute cases (complete & contradictory evidence)</li>
            </ul>
          </section>
        </div>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-red-900 mb-3">⚠️ Important Disclaimer</h2>
        <p className="text-sm text-red-800">
          This is a <strong>Razorpay Buildathon prototype</strong> for demonstration purposes only.
          It is <strong>not production-ready</strong> and does not meet compliance requirements for real financial operations.
          Do not use with real customer data, real payments, or in production environments.
        </p>
      </div>
    </div>
  );
}
