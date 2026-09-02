import { ReactNode } from "react";
import Link from "next/link";
import { NavLink } from "@/src/components/nav-link";

/**
 * The console shell.
 *
 * Navigation is labelled by what an operator is trying to accomplish, not by
 * the internal entity they happen to be reading. "Suppliers at risk" is a job;
 * "LiquidityObservation" is a table.
 */

const SECTIONS: Array<{
  heading: string;
  items: Array<{ href: string; label: string; hint: string }>;
}> = [
  {
    heading: "Decide",
    items: [
      {
        href: "/dashboard",
        label: "Overview",
        hint: "Today at a glance",
      },
      {
        href: "/dashboard/opportunities",
        label: "Suppliers at risk",
        hint: "Who needs cash, and why",
      },
    ],
  },
  {
    heading: "Move money",
    items: [
      {
        href: "/dashboard/payments",
        label: "Money movement",
        hint: "Every payment, end to end",
      },
      {
        href: "/dashboard/reconciliation",
        label: "Exceptions",
        hint: "Where we and the provider disagree",
      },
    ],
  },
  {
    heading: "Prove it",
    items: [
      {
        href: "/dashboard/ledger",
        label: "Trial balance",
        hint: "The books foot",
      },
      {
        href: "/dashboard/disputes",
        label: "Dispute evidence",
        hint: "Chargeback response drafts",
      },
      {
        href: "/dashboard/model",
        label: "Model card",
        hint: "Accuracy and limits",
      },
    ],
  },
  {
    heading: "Demo",
    items: [
      {
        href: "/dashboard/demo",
        label: "Guided walkthrough",
        hint: "Run the whole story",
      },
      {
        href: "/dashboard/scope",
        label: "Scope and controls",
        hint: "What this does not do",
      },
    ],
  },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-page">
      <div className="flex">
        {/* -------------------------------------------------------- Sidebar */}
        <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col overflow-y-auto bg-surface-inverse text-ink-inverse">
          <div className="px-5 py-5">
            <Link href="/" className="focusable block rounded">
              <h1 className="text-lg font-semibold tracking-tight text-white">
                Equilibrium
              </h1>
              <p className="mt-0.5 text-2xs leading-snug text-slate-400">
                Early payments, proven correct
              </p>
            </Link>
          </div>

          <nav className="flex-1 space-y-5 px-3 pb-4">
            {SECTIONS.map((section) => (
              <div key={section.heading}>
                <p className="px-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                  {section.heading}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      hint={item.hint}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-slate-800 px-5 py-4">
            <p className="text-2xs font-medium text-slate-300">
              Priya Raman
            </p>
            <p className="text-2xs text-slate-500">Finance operator</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-medium text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Mock provider · synthetic data
            </p>
          </div>
        </aside>

        {/* ----------------------------------------------------------- Main */}
        <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
