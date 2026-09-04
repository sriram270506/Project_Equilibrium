import { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/src/lib/utils";

/**
 * Shared UI primitives.
 *
 * Every screen renders through these, which is what lets the whole console
 * change material without rewriting fifteen pages. Glass treatment, hover
 * physics, and contrast rules live here rather than being reinvented per page.
 */

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  children,
  tone = "default",
  interactive = true,
}: {
  className?: string;
  children: ReactNode;
  tone?: "default" | "raised" | "accent" | "flat";
  /** Lift and brighten under the pointer. Off for purely static containers. */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card",
        // Blur via Tailwind utilities: a raw backdrop-filter in globals.css is
        // stripped by the build, which left every panel unblurred.
        tone !== "flat" && "glass backdrop-blur-glass backdrop-saturate-150",
        tone === "raised" && "glass-raised",
        tone === "accent" && "glass-accent",
        tone === "flat" &&
          "border border-white/[0.07] bg-white/[0.02] rounded-card",
        interactive && tone !== "flat" && "glass-interactive glass-sheen",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  action,
  eyebrow,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h2 className="text-[15px] font-semibold tracking-tight text-ink-strong">
          {title}
        </h2>
        {hint ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

/* ------------------------------------------------------------- Page header */

export function PageHeader({
  title,
  lede,
  action,
}: {
  title: string;
  lede?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="fade-up mb-7 flex items-start justify-between gap-6">
      <div className="max-w-3xl">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink-strong">
          {title}
        </h1>
        {lede ? (
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-muted">
            {lede}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------- Stat */

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "brand";
  emphasis?: boolean;
}) {
  const valueTone = {
    neutral: "text-ink-strong",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    brand: "text-brand-bright",
  }[tone];

  const glow = {
    neutral: "",
    ok: "shadow-glow-ok",
    warn: "shadow-glow-warn",
    danger: "shadow-glow-danger",
    brand: "shadow-glow-brand",
  }[tone];

  return (
    <Card
      tone={emphasis ? "accent" : "default"}
      className={cn("group p-5", emphasis && glow)}
    >
      <p className="text-[12px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p
        className={cn(
          "tabular mt-2.5 text-[30px] font-semibold leading-none transition-transform duration-300 ease-spring group-hover:scale-[1.03] group-hover:origin-left",
          valueTone,
          tone === "brand" && "figure-glow"
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-2.5 text-[13px] leading-snug text-ink-faint">{hint}</p>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    // Both stops are dark enough for white text at 13px. The brighter blue
  // looked better and measured 2.5:1 against white, well under the 4.5:1 floor.
  "bg-gradient-to-b from-brand-deep to-[rgb(29_78_216)] text-white border-white/25 shadow-glow-brand hover:shadow-[0_0_40px_-6px_rgb(var(--brand)/0.7)] hover:from-brand hover:to-brand-deep",
  secondary:
    "bg-white/[0.06] text-ink-strong border-white/[0.14] hover:bg-white/[0.11] hover:border-white/25",
  ghost:
    "bg-transparent text-ink-muted border-transparent hover:bg-white/[0.07] hover:text-ink-strong",
  danger:
    "bg-gradient-to-b from-danger to-danger-deep text-white border-white/20 shadow-glow-danger",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "focusable btn-lift inline-flex items-center justify-center gap-2 rounded-lg border font-medium backdrop-blur-sm",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0",
        size === "sm" ? "px-3.5 py-1.5 text-[13px]" : "px-4.5 py-2.5 text-sm",
        buttonVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- Money */

/**
 * Render a paise amount as rupees with tabular figures.
 * Money math never happens in the view - only formatting.
 */
export function Money({
  paise,
  className,
  sign = false,
}: {
  paise: number;
  className?: string;
  sign?: boolean;
}) {
  const rupees = Math.abs(paise) / 100;
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
  const prefix = paise < 0 ? "−" : sign ? "+" : "";
  return (
    <span className={cn("tabular", className)}>
      {prefix}
      {formatted}
    </span>
  );
}

/* ---------------------------------------------------------------- Callout */

export function Callout({
  tone = "info",
  title,
  children,
  icon,
}: {
  tone?: "info" | "ok" | "warn" | "danger" | "brand";
  title?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const tones = {
    info: "border-info/30 bg-info/[0.09]",
    ok: "border-ok/30 bg-ok/[0.09]",
    warn: "border-warn/30 bg-warn/[0.09]",
    danger: "border-danger/30 bg-danger/[0.09]",
    brand: "border-brand/35 bg-brand/[0.10]",
  }[tone];

  const bar = {
    info: "bg-info",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    brand: "bg-brand",
  }[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card border px-4 py-3.5 text-ink-body backdrop-blur-xl",
        tones
      )}
    >
      {/* A lit edge on the left, so intent is readable before the text is. */}
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", bar)} />
      <div className="flex gap-3 pl-1">
        {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
        <div className="min-w-0 text-sm leading-relaxed">
          {title ? (
            <p className="mb-1 font-semibold text-ink-strong">{title}</p>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ States */

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <Card interactive={false} className="px-5 py-10">
      <div className="flex items-center justify-center gap-3 text-sm text-ink-muted">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-brand-bright" />
        </span>
        {label}…
      </div>
    </Card>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Callout tone="danger" title="Something went wrong">
      <p>{message}</p>
      {onRetry ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Callout>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card interactive={false} className="px-5 py-12 text-center">
      <p className="text-sm font-semibold text-ink-strong">{title}</p>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------- Table */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children?: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "border-b border-white/[0.12] px-4 py-3 text-2xs font-semibold uppercase tracking-wider text-ink-muted",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-white/[0.05] px-4 py-3 text-ink-body",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </td>
  );
}

/** Table row with a hover wash, for rows that link somewhere. */
export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "transition-colors duration-200 hover:bg-white/[0.045]",
        className
      )}
    >
      {children}
    </tr>
  );
}

/* --------------------------------------------------------------- Data rows */

export function DataRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-2.5 last:border-0">
      <div>
        <span className="text-[13px] text-ink-muted">{label}</span>
        {hint ? <p className="text-2xs text-ink-faint">{hint}</p> : null}
      </div>
      <span className="text-right text-sm font-medium text-ink-strong">
        {children}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- Mono id */

/** Correlation ids, payment ids, hashes - anything meant to be compared by eye. */
export function MonoId({
  value,
  truncate = 0,
  className,
}: {
  value: string;
  truncate?: number;
  className?: string;
}) {
  const shown =
    truncate > 0 && value.length > truncate
      ? `${value.slice(0, truncate)}…`
      : value;
  return (
    <span
      className={cn(
        "mono rounded bg-white/[0.05] px-1.5 py-0.5 text-ink-muted",
        className
      )}
      title={value}
    >
      {shown}
    </span>
  );
}
