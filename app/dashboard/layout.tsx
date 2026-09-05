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
      {
        href: "/dashboard/controller",
        label: "AI controller",
        hint: "Bounded recommendations and traces",
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
        href: "/dashboard/track04",
        label: "Track 04 benchmark",
        hint: "546 labelled records, scored",
      },
      {
        href: "/dashboard/track04/review",
        label: "Exception review",
        hint: "Decide what the controller would not",
      },
      {
        href: "/dashboard/track04/history",
        label: "Run history",
        hint: "Every evaluation, versioned",
      },
      {
        href: "/dashboard/model",
        label: "Model card",
        hint: "Accuracy and limits",
      },
      {
        href: "/dashboard/controls",
        label: "Risk controls",
        hint: "Limits, kill switch, audit chain",
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
        href: "/dashboard/failures",
        label: "Failure injection",
        hint: "Break it on purpose",
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
    <div className="relative min-h-screen">
      {/* Aurora sits behind everything and never intercepts a pointer. */}
      <div className="aurora-field aurora-drift" aria-hidden="true" />

      <div className="relative z-10 flex">
        {/* -------------------------------------------------------- Sidebar */}
        <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-canvas-deep/70 backdrop-blur-2xl">
          <div className="px-5 py-5">
            <Link href="/" className="focusable group block rounded-lg">
              <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink-strong">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gradient-to-br from-brand-bright to-cyanAccent" />
                </span>
                <span className="transition-colors duration-200 group-hover:text-brand-bright">
                  Equilibrium
                </span>
              </h1>
              <p className="mt-1 pl-[18px] text-2xs leading-snug text-ink-faint">
                Early payments, proven correct
              </p>
            </Link>
          </div>

          <nav className="flex-1 space-y-5 px-3 pb-4">
            {SECTIONS.map((section) => (
              <div key={section.heading}>
                <p className="px-2 pb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
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

          <div className="border-t border-white/[0.07] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand to-violetAccent text-2xs font-semibold text-white">
                PR
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-medium text-ink-body">Priya Raman</p>
                <p className="text-2xs text-ink-faint">Finance operator</p>
              </div>
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/[0.12] px-2.5 py-1 text-2xs font-medium text-warn backdrop-blur-md">
              <span className="status-breathe h-1.5 w-1.5 rounded-full bg-warn" />
              Mock provider · synthetic data
            </p>
          </div>
        </aside>

        {/* ----------------------------------------------------------- Main */}
        <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
