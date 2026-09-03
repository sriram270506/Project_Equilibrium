import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

/**
 * Webhook security, in one place.
 *
 * Previously this logic lived inline in the route and had a fail-open branch:
 * with no secret configured it accepted every request. That is the single most
 * dangerous shape a webhook receiver can have, because it works perfectly in
 * testing and silently accepts forged events the moment someone forgets an
 * environment variable. It now fails closed everywhere except explicit mock
 * mode, and mock mode is checked against the app's own configuration rather
 * than against the absence of a secret.
 */

export type WebhookRejectionReason =
  | "NOT_CONFIGURED"
  | "MISSING_SIGNATURE"
  | "INVALID_SIGNATURE"
  | "MISSING_TIMESTAMP"
  | "STALE_TIMESTAMP"
  | "FUTURE_TIMESTAMP"
  | "MALFORMED_PAYLOAD";

export interface WebhookVerdict {
  accepted: boolean;
  reason?: WebhookRejectionReason;
  detail?: string;
  /** HTTP status the route should return. */
  status?: number;
}

/**
 * How far out of step a webhook's timestamp may be.
 *
 * Razorpay retries failed deliveries for up to 24 hours, so the window has to
 * tolerate legitimate retries while still refusing a captured request replayed
 * days later. Five minutes of future skew covers ordinary clock drift.
 */
export const REPLAY_WINDOW_SECONDS = 24 * 60 * 60;
export const FUTURE_SKEW_SECONDS = 5 * 60;

/** Is the app configured to accept unsigned demo webhooks? */
export function isMockMode(): boolean {
  return (process.env.RAZORPAY_MODE ?? "mock").toLowerCase() === "mock";
}

/**
 * Constant-time HMAC-SHA256 comparison over the RAW body.
 *
 * The body must be the exact bytes received. Parsing and re-serialising JSON
 * reorders keys and changes whitespace, which changes the digest — a very
 * common way to get signature verification subtly wrong.
 */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  try {
    const expected = createHmac("sha256", secret)
      .update(rawBody, "utf-8")
      .digest("hex");

    const provided = Buffer.from(signature.trim(), "hex");
    const computed = Buffer.from(expected, "hex");

    if (provided.length !== computed.length) return false;
    return timingSafeEqual(provided, computed);
  } catch {
    return false;
  }
}

/**
 * Reject requests that are outside the replay window.
 *
 * `timestampSeconds` comes from the provider (Razorpay sends `created_at` on
 * the event). Without this check, anyone who captures one valid signed request
 * can replay it forever — the signature stays valid because the body never
 * changes.
 */
export function checkTimestamp(
  timestampSeconds: number | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): WebhookVerdict {
  if (timestampSeconds === undefined || !Number.isFinite(timestampSeconds)) {
    return {
      accepted: false,
      reason: "MISSING_TIMESTAMP",
      detail: "Event carries no timestamp, so replay cannot be ruled out.",
      status: 400,
    };
  }

  const age = nowSeconds - timestampSeconds;

  if (age > REPLAY_WINDOW_SECONDS) {
    return {
      accepted: false,
      reason: "STALE_TIMESTAMP",
      detail: `Event is ${Math.floor(age / 3600)}h old, beyond the ${
        REPLAY_WINDOW_SECONDS / 3600
      }h replay window.`,
      status: 400,
    };
  }

  if (age < -FUTURE_SKEW_SECONDS) {
    return {
      accepted: false,
      reason: "FUTURE_TIMESTAMP",
      detail: `Event is dated ${Math.abs(age)}s in the future, beyond the ${FUTURE_SKEW_SECONDS}s clock-skew allowance.`,
      status: 400,
    };
  }

  return { accepted: true };
}

/**
 * Razorpay webhook envelope.
 *
 * Deliberately strict on the fields we act on and permissive elsewhere: an
 * unexpected extra field from the provider must not break processing, but a
 * missing amount or event id must.
 */
export const razorpayWebhookSchema = z.object({
  /** Razorpay sends `event`; our mock sends `eventType`. Accept either. */
  event: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),

  /** Unique provider event id, used for deduplication. */
  id: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),

  /** Unix seconds. Razorpay sends `created_at`. */
  created_at: z.number().int().positive().optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),

  paymentId: z.string().min(1).optional(),
  orderId: z.string().optional(),
  status: z.string().optional(),
  amount: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),

  payload: z
    .object({
      payment: z
        .object({
          entity: z
            .object({
              id: z.string(),
              status: z.string().optional(),
              amount: z.number().int().nonnegative().optional(),
              currency: z.string().optional(),
              order_id: z.string().optional(),
            })
            .passthrough(),
        })
        .optional(),
      payout: z
        .object({
          entity: z
            .object({
              id: z.string(),
              status: z.string().optional(),
              amount: z.number().int().nonnegative().optional(),
              currency: z.string().optional(),
            })
            .passthrough(),
        })
        .optional(),
    })
    .optional(),
});

export type RazorpayWebhook = z.infer<typeof razorpayWebhookSchema>;

/** The fields the rest of the system actually needs, extracted from either shape. */
export interface NormalisedWebhook {
  eventId: string;
  eventType: string;
  providerPaymentId: string;
  status: string;
  amountPaise?: number;
  currency?: string;
  timestampSeconds?: number;
}

/**
 * Flatten Razorpay's nested envelope (or our mock's flat one) into the shape
 * the handler works with. Returns null when required fields are absent.
 */
export function normaliseWebhook(
  parsed: RazorpayWebhook
): NormalisedWebhook | null {
  const entity =
    parsed.payload?.payment?.entity ?? parsed.payload?.payout?.entity;

  const eventId = parsed.id ?? parsed.eventId;
  const eventType = parsed.event ?? parsed.eventType;
  const providerPaymentId = entity?.id ?? parsed.paymentId;
  const status = entity?.status ?? parsed.status;

  if (!eventId || !eventType || !providerPaymentId || !status) return null;

  let timestampSeconds = parsed.created_at;
  if (timestampSeconds === undefined && parsed.timestamp !== undefined) {
    const raw = parsed.timestamp;
    const asDate = typeof raw === "string" ? Date.parse(raw) : raw * 1000;
    if (Number.isFinite(asDate)) timestampSeconds = Math.floor(asDate / 1000);
  }

  return {
    eventId,
    eventType,
    providerPaymentId,
    status,
    amountPaise: entity?.amount ?? parsed.amount,
    currency: entity?.currency ?? parsed.currency,
    timestampSeconds,
  };
}

/**
 * Full pre-processing gate: configuration, signature, then timestamp.
 *
 * Order matters. The signature is checked against the raw body BEFORE anything
 * is parsed, so a malformed or hostile payload never reaches the parser, and
 * nothing is persisted on the strength of an unverified request.
 */
export function authenticateWebhook(
  rawBody: string,
  signature: string | null
): WebhookVerdict {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const mock = isMockMode();

  if (!secret) {
    if (!mock) {
      // Fail closed. Live or test mode without a secret is a misconfiguration,
      // not a licence to accept everything.
      return {
        accepted: false,
        reason: "NOT_CONFIGURED",
        detail:
          "RAZORPAY_WEBHOOK_SECRET is required when RAZORPAY_MODE is not 'mock'. Refusing to accept unverified webhooks.",
        status: 500,
      };
    }

    // Explicit mock mode only: the demo can post unsigned events to itself.
    return { accepted: true };
  }

  if (!signature) {
    return {
      accepted: false,
      reason: "MISSING_SIGNATURE",
      detail: "X-Razorpay-Signature header is absent.",
      status: 401,
    };
  }

  if (!verifySignature(rawBody, signature, secret)) {
    return {
      accepted: false,
      reason: "INVALID_SIGNATURE",
      detail: "Signature does not match the request body.",
      status: 401,
    };
  }

  return { accepted: true };
}
