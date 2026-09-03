/**
 * Structured logging.
 *
 * Every line is a single JSON object on one line, so logs are greppable and
 * machine-parseable. `console.error("something broke")` is unsearchable the
 * moment you have more than one request in flight: you cannot filter by
 * payment, by operator, or by correlation id, which is exactly what you need
 * during an incident.
 *
 * Deliberately dependency-free. A prototype does not need pino, but it does
 * need every log line to carry the ids that let one payment be traced end to
 * end.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function activeLevel(): LogLevel {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (["debug", "info", "warn", "error"] as LogLevel[]).includes(
    configured as LogLevel
  )
    ? (configured as LogLevel)
    : "info";
}

/** Fields that must never reach a log line, whatever the caller passes. */
const REDACTED_KEYS = new Set([
  "apikey",
  "api_key",
  "secret",
  "password",
  "authorization",
  "token",
  "keysecret",
  "key_secret",
  "razorpay_key_secret",
  "webhooksecret",
  "webhook_secret",
  "signature",
  "email",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as object)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase())
        ? "[redacted]"
        : redact(inner, depth + 1);
    }
    return out;
  }

  return value;
}

export interface LogContext {
  correlationId?: string;
  requestId?: string;
  operatorId?: string;
  paymentIntentId?: string;
  providerPaymentId?: string;
  eventId?: string;
  supplierId?: string;
  route?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogContext): void;
  info(message: string, fields?: LogContext): void;
  warn(message: string, fields?: LogContext): void;
  error(message: string, fields?: LogContext): void;
  /** Derive a logger that stamps `bound` onto every line. */
  child(bound: LogContext): Logger;
  /** Time an operation and log its duration and outcome. */
  time<T>(message: string, fn: () => Promise<T>, fields?: LogContext): Promise<T>;
}

function emit(
  level: LogLevel,
  message: string,
  bound: LogContext,
  fields: LogContext
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[activeLevel()]) return;

  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact({ ...bound, ...fields }) as LogContext),
  };

  const serialised = JSON.stringify(line);

  if (level === "error") console.error(serialised);
  else if (level === "warn") console.warn(serialised);
  else console.log(serialised);
}

function build(bound: LogContext): Logger {
  return {
    debug: (message, fields = {}) => emit("debug", message, bound, fields),
    info: (message, fields = {}) => emit("info", message, bound, fields),
    warn: (message, fields = {}) => emit("warn", message, bound, fields),
    error: (message, fields = {}) => emit("error", message, bound, fields),
    child: (extra) => build({ ...bound, ...extra }),
    async time(message, fn, fields = {}) {
      const started = Date.now();
      try {
        const result = await fn();
        emit("info", message, bound, {
          ...fields,
          durationMs: Date.now() - started,
          outcome: "ok",
        });
        return result;
      } catch (error) {
        emit("error", message, bound, {
          ...fields,
          durationMs: Date.now() - started,
          outcome: "error",
          error: (error as Error).message,
        });
        throw error;
      }
    },
  };
}

export const logger: Logger = build({ service: "equilibrium" });

/**
 * Read or mint a correlation id for a request.
 *
 * Accepting an inbound `X-Correlation-ID` is what lets a trace span the UI, the
 * API, the provider call and the ledger entry rather than restarting at every
 * hop.
 */
export function correlationIdFrom(request: {
  headers: { get(name: string): string | null };
}): string {
  return (
    request.headers.get("x-correlation-id") ??
    request.headers.get("x-request-id") ??
    `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}
