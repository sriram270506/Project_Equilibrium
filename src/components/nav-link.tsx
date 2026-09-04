"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/src/lib/utils";

/**
 * Sidebar link that knows whether it is the current page. Exact match for the
 * overview so it does not stay lit on every child route.
 */
export function NavLink({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint?: string;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focusable group relative block rounded-lg px-2.5 py-2 transition-all duration-200 ease-spring",
        active
          ? "bg-brand/[0.16] text-ink-strong shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08)]"
          : "text-ink-muted hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-ink-strong"
      )}
    >
      {/* A lit rail on the active item, so position is readable peripherally. */}
      {active ? (
        <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-gradient-to-b from-brand-bright to-cyanAccent shadow-glow-brand" />
      ) : null}
      <span className="flex items-center gap-2 text-[13px] font-medium">
        {active ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-bright shadow-glow-brand" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/[0.14] transition-colors duration-200 group-hover:bg-white/30" />
        )}
        {label}
      </span>
      {hint ? (
        <span className="mt-0.5 block pl-3.5 text-2xs leading-snug text-ink-faint">
          {hint}
        </span>
      ) : null}
    </Link>
  );
}
