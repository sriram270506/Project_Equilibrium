import { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/src/lib/utils";

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  children,
  tone = "default",
}: {
  className?: string;
  children: ReactNode;
  tone?: "default" | "sunken" | "inverse";
}) {
  return (
    <div
      className={cn(
        "rounded-card border shadow-card",
        tone === "default" && "border-line-soft bg-surface-card",
        tone === "sunken" && "border-line-soft bg-surface-sunken",
        tone === "inverse" &&
          "border-transparent bg-surface-inverse text-ink-inverse",
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
    <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-ink-muted">{hint}</p> : null}
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
    <header className="mb-6 flex items-start justify-between gap-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">
          {title}
        </h1>
        {lede ? (
          <p className="mt-2 text-[15px] leading-relaxed text-ink-body">
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
    brand: "text-brand-strong",
  }[tone];

  return (
    <Card className={cn("p-5", emphasis && "ring-1 ring-brand/25")}>
      <p className="text-[13px] font-medium text-ink-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-2 text-[28px] font-semibold leading-none",
          valueTone
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-[13px] leading-snug text-ink-muted">{hint}</p>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-strong border-transparent shadow-card",
  secondary:
    "bg-surface-card text-ink-strong hover:bg-surface-sunken border-line-strong",
  ghost:
    "bg-transparent text-ink-body hover:bg-surface-sunken border-transparent",
  danger:
    "bg-danger text-white hover:brightness-95 border-transparent shadow-card",
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
        "focusable inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-sm",
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
    info: "border-info/25 bg-info-wash",
    ok: "border-ok/25 bg-ok-wash",
    warn: "border-warn/30 bg-warn-wash",
    danger: "border-danger/25 bg-danger-wash",
    brand: "border-brand/25 bg-brand-wash",
  }[tone];

  return (
    <div className={cn("rounded-card border p-4 text-ink-body", tones)}>
      <div className="flex gap-3">
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
    <div className="flex items-center gap-3 rounded-card border border-line-soft bg-surface-card px-5 py-8 text-sm text-ink-muted">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" />
      {label}
    </div>
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
    <Card className="px-5 py-10 text-center">
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
        "border-b border-line-strong px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted",
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
        "border-b border-line-soft px-4 py-3 text-ink-body",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </td>
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
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-2.5 last:border-0">
      <div>
        <span className="text-[13px] text-ink-muted">{label}</span>
        {hint ? <p className="text-2xs text-ink-muted/80">{hint}</p> : null}
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
    <span className={cn("mono text-ink-muted", className)} title={value}>
      {shown}
    </span>
  );
}
