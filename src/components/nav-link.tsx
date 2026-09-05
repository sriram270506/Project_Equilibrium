"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/src/lib/utils";

/**
 * Sidebar link that knows whether it is the current page. Exact match for the
 * overview so it does not stay lit on every child route.
 *
 * These sit on the navy spine, so the colour logic is inverted from the rest
 * of the app: near-white text on dark, not ink on paper. The active state is a
 * SOLID left rail plus a lifted background rather than a glow — the spine is
 * the one dark surface in the product and a glow there would be the only
 * neon in an otherwise printed interface.
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
        "focusable group relative block rounded-[3px] py-2 pl-3.5 pr-2.5 transition-colors duration-150",
        active
          ? "bg-white/[0.10] text-white"
          : "text-white/60 hover:bg-white/[0.06] hover:text-white/90"
      )}
    >
      {/*
        The rail. Razorpay blue, full-height, square — a tab marker in a bound
        ledger rather than a rounded pill.
      */}
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-[3px] transition-colors duration-150",
          active ? "bg-brand-bright" : "bg-transparent"
        )}
      />
      <span
        className={cn(
          "block text-[13px] leading-tight",
          active ? "font-semibold" : "font-medium"
        )}
      >
        {label}
      </span>
      {hint ? (
        <span
          className={cn(
            "mt-0.5 block text-2xs leading-snug transition-colors duration-150",
            active ? "text-white/75" : "text-white/60 group-hover:text-white/80"
          )}
        >
          {hint}
        </span>
      ) : null}
    </Link>
  );
}
