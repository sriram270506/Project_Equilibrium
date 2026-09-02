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
        "focusable block rounded-md px-2 py-1.5 transition-colors",
        active
          ? "bg-brand/15 text-white"
          : "text-slate-300 hover:bg-slate-800 hover:text-white"
      )}
    >
      <span className="flex items-center gap-2 text-[13px] font-medium">
        {active ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0" />
        )}
        {label}
      </span>
      {hint ? (
        <span className="mt-0.5 block pl-3.5 text-2xs leading-snug text-slate-500">
          {hint}
        </span>
      ) : null}
    </Link>
  );
}
