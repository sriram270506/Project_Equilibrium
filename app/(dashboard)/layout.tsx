import { ReactNode } from "react";
import Link from "next/link";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Demo Mode Banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center">
        <p className="text-sm font-medium text-amber-900">
          🧪 Demo Mode - MockRazorpay Provider - Synthetic Data
        </p>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-slate-900 text-white p-6 min-h-screen">
          <div className="mb-8">
            <h1 className="text-2xl font-bold">Equilibrium</h1>
            <p className="text-sm text-slate-400">
              Bounded intelligence for safer payments
            </p>
          </div>

          <nav className="space-y-2">
            {[
              { href: "/dashboard", label: "Overview" },
              { href: "/dashboard/opportunities", label: "Liquidity Opportunities" },
              { href: "/dashboard/payments", label: "Payment Operations" },
              { href: "/dashboard/disputes", label: "Dispute Evidence" },
              { href: "/dashboard/reconciliation", label: "Reconciliation" },
              { href: "/dashboard/demo", label: "Demo Controls" },
              { href: "/dashboard/scope", label: "Scope & Controls" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block px-4 py-2 rounded-md hover:bg-slate-800 transition-colors text-sm"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto pt-8 border-t border-slate-700">
            <p className="text-xs text-slate-500">
              Operator: demo-finance-operator
            </p>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
