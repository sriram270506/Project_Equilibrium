import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  authenticateWebhook,
  checkTimestamp,
  verifySignature,
  normaliseWebhook,
  razorpayWebhookSchema,
  REPLAY_WINDOW_SECONDS,
  FUTURE_SKEW_SECONDS,
} from "./webhook-security";

const SECRET = "whsec_test_abc123";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf-8").digest("hex");
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.RAZORPAY_MODE = "mock";
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Webhook signature verification", () => {
  const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });

  it("accepts a correctly signed body", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a modified body", () => {
    const signature = sign(body);
    expect(verifySignature(body + " ", signature, SECRET)).toBe(false);
    expect(
      verifySignature(body.replace("captured", "failed"), signature, SECRET)
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifySignature(body, sign(body, "wrong_secret"), SECRET)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifySignature(body, null, SECRET)).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifySignature(body, "not-hex-at-all", SECRET)).toBe(false);
    expect(verifySignature(body, "", SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length", () => {
    expect(verifySignature(body, "abcd", SECRET)).toBe(false);
  });
});

describe("Webhook authentication gate", () => {
  const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });

  it("FAILS CLOSED outside mock mode when no secret is configured", () => {
    process.env.RAZORPAY_MODE = "live";
    const verdict = authenticateWebhook(body, sign(body));

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("NOT_CONFIGURED");
    expect(verdict.status).toBe(500);
  });

  it("also fails closed in 'test' mode, not only 'live'", () => {
    process.env.RAZORPAY_MODE = "test";
    expect(authenticateWebhook(body, sign(body)).accepted).toBe(false);
  });

  it("accepts unsigned events ONLY in explicit mock mode", () => {
    process.env.RAZORPAY_MODE = "mock";
    expect(authenticateWebhook(body, null).accepted).toBe(true);
  });

  it("enforces signatures in mock mode too, once a secret is set", () => {
    process.env.RAZORPAY_MODE = "mock";
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

    expect(authenticateWebhook(body, sign(body)).accepted).toBe(true);

    const bad = authenticateWebhook(body, "f".repeat(64));
    expect(bad.accepted).toBe(false);
    expect(bad.reason).toBe("INVALID_SIGNATURE");
    expect(bad.status).toBe(401);
  });

  it("returns 401 for a missing signature when a secret is configured", () => {
    process.env.RAZORPAY_MODE = "live";
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

    const verdict = authenticateWebhook(body, null);
    expect(verdict.reason).toBe("MISSING_SIGNATURE");
    expect(verdict.status).toBe(401);
  });
});

describe("Replay protection", () => {
  const now = 1_800_000_000;

  it("accepts a current event", () => {
    expect(checkTimestamp(now - 5, now).accepted).toBe(true);
  });

  it("accepts a legitimate provider retry inside the window", () => {
    expect(checkTimestamp(now - REPLAY_WINDOW_SECONDS + 60, now).accepted).toBe(
      true
    );
  });

  it("rejects an event replayed after the window", () => {
    const verdict = checkTimestamp(now - REPLAY_WINDOW_SECONDS - 60, now);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("STALE_TIMESTAMP");
  });

  it("rejects an event dated far in the future", () => {
    const verdict = checkTimestamp(now + FUTURE_SKEW_SECONDS + 60, now);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("FUTURE_TIMESTAMP");
  });

  it("tolerates small clock skew", () => {
    expect(checkTimestamp(now + 60, now).accepted).toBe(true);
  });

  it("rejects an event with no timestamp at all", () => {
    const verdict = checkTimestamp(undefined, now);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("MISSING_TIMESTAMP");
  });
});

describe("Webhook payload validation", () => {
  it("accepts a Razorpay-shaped event", () => {
    const parsed = razorpayWebhookSchema.safeParse({
      event: "payment.captured",
      id: "evt_abc123",
      created_at: 1800000000,
      payload: {
        payment: {
          entity: {
            id: "pay_xyz",
            status: "captured",
            amount: 150000,
            currency: "INR",
          },
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a negative amount", () => {
    const parsed = razorpayWebhookSchema.safeParse({
      event: "payment.captured",
      id: "evt_1",
      amount: -500,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    const parsed = razorpayWebhookSchema.safeParse({
      event: "payment.captured",
      id: "evt_1",
      amount: 1500.75,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed currency code", () => {
    const parsed = razorpayWebhookSchema.safeParse({
      event: "payment.captured",
      id: "evt_1",
      currency: "RUPEES",
    });
    expect(parsed.success).toBe(false);
  });

  it("tolerates unknown extra fields from the provider", () => {
    const parsed = razorpayWebhookSchema.safeParse({
      event: "payment.captured",
      id: "evt_1",
      account_id: "acc_new_field",
      contains: ["payment"],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("Webhook normalisation", () => {
  it("flattens Razorpay's nested envelope", () => {
    const parsed = razorpayWebhookSchema.parse({
      event: "payment.captured",
      id: "evt_abc",
      created_at: 1800000000,
      payload: {
        payment: {
          entity: {
            id: "pay_123",
            status: "captured",
            amount: 150000,
            currency: "INR",
          },
        },
      },
    });

    const event = normaliseWebhook(parsed);
    expect(event).toEqual({
      eventId: "evt_abc",
      eventType: "payment.captured",
      providerPaymentId: "pay_123",
      status: "captured",
      amountPaise: 150000,
      currency: "INR",
      timestampSeconds: 1800000000,
    });
  });

  it("handles the flat shape our mock emits", () => {
    const parsed = razorpayWebhookSchema.parse({
      eventType: "payment.confirmed",
      eventId: "evt_mock",
      paymentId: "pay_demo",
      status: "CONFIRMED",
      amount: 62000,
    });

    const event = normaliseWebhook(parsed);
    expect(event?.eventId).toBe("evt_mock");
    expect(event?.providerPaymentId).toBe("pay_demo");
  });

  it("returns null when a required field is absent", () => {
    const parsed = razorpayWebhookSchema.parse({ event: "payment.captured" });
    expect(normaliseWebhook(parsed)).toBeNull();
  });

  it("reads a payout entity as well as a payment entity", () => {
    const parsed = razorpayWebhookSchema.parse({
      event: "payout.processed",
      id: "evt_payout",
      payload: {
        payout: {
          entity: { id: "pout_1", status: "processed", amount: 95000 },
        },
      },
    });

    const event = normaliseWebhook(parsed);
    expect(event?.providerPaymentId).toBe("pout_1");
    expect(event?.status).toBe("processed");
  });
});
