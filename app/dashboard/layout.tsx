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
      {/*
        Ruled paper behind everything. Fixed and pointer-events-none, so it
        never intercepts a click.
      */}
      <div className="ledger-field ledger-field-console" aria-hidden="true" />

      <div className="relative z-10 flex">
        {/*
          ------------------------------------------------------------ Spine

          The one dark surface in the product: Razorpay navy, full height,
          square-edged. Against warm paper it reads as the bound edge of a
          ledger, and it gives the interface a strong vertical anchor that a
          light-on-light sidebar cannot.
        */}
        <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col overflow-y-auto bg-brand-deep">
          <div className="border-b border-white/[0.09] px-5 py-5">
            <Link href="/" className="focusable group block rounded-[3px]">
              <h1 className="display flex items-baseline gap-2 text-[22px] leading-none text-white">
                Equilibrium
              </h1>
              <p className="mt-2 text-2xs uppercase tracking-[0.16em] text-brand-bright">
                Finance controller
              </p>
            </Link>
          </div>

          <nav className="flex-1 space-y-6 py-5 pl-0 pr-3">
            {SECTIONS.map((section) => (
              <div key={section.heading}>
                {/* Section label over a rule, as on a printed index. */}
                <p className="mb-2 ml-3.5 mr-2 border-b border-white/[0.12] pb-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-white/65">
                  {section.heading}
                </p>
                <div className="space-y-px">
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

          <div className="border-t border-white/[0.09] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-brand-bright text-2xs font-bold text-brand-ink">
                PR
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-medium text-white/90">
                  Priya Raman
                </p>
                <p className="text-2xs text-white/65">Finance operator</p>
              </div>
            </div>
            {/*
              A stamp rather than a pill. This is a standing disclosure about
              what the reader is looking at, and a stamp is the shape that
              carries that weight.
            */}
            <p className="stamp mt-3.5 border-warn/70 text-warn">
              <span className="status-breathe h-1.5 w-1.5 rounded-full bg-warn" />
              Mock provider
            </p>
          </div>
        </aside>

        {/* ----------------------------------------------------------- Main */}
        <main className="min-w-0 flex-1 px-10 py-9">{children}</main>
      </div>
    </div>
  );
}
