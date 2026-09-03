import { createHmac, timingSafeEqual } from "crypto";
import {
  CreateOperationInput,
  PaymentProvider,
  ProviderOperationResult,
  ProviderPaymentStatus,
} from "./provider-types";

/**
 * Live Razorpay adapter (Test Mode by default).
 *
 * This talks to the real Razorpay HTTP API. It is the counterpart to
 * MockRazorpay: same `PaymentProvider` interface, no business-logic changes
 * required to swap between them.
 *
 * WHICH RAZORPAY PRIMITIVE THIS USES, AND WHY
 * -------------------------------------------
 * Equilibrium disburses money to suppliers, so the correct Razorpay primitive
 * is **RazorpayX Payouts** (`POST /v1/payouts`), not the Payments/Orders
 * acceptance APIs. Two properties of that endpoint matter here:
 *
 *   1. `X-Payout-Idempotency` — Razorpay's own idempotency header. Replaying a
 *      request with the same header value returns the original payout instead
 *      of creating a second one. This is why `providerIdempotencyKey` is
 *      generated server-side and stored on the PaymentIntent before the call:
 *      our key and Razorpay's are the same key.
 *
 *   2. Payout status is genuinely asynchronous: `queued` -> `processing` ->
 *      `processed`, or `reversed` / `failed`. A payout can sit in `processing`
 *      for minutes. That is precisely why this system records UNKNOWN rather
 *      than assuming an outcome, and why reconciliation exists.
 *
 * `ORDERS` mode is provided as a fallback because RazorpayX requires a separate
 * account, while `POST /v1/orders` works with any standard test key. It creates
 * a real Razorpay object a reviewer can look up in the dashboard, which is
 * enough to demonstrate live connectivity and signature handling even without
 * RazorpayX access.
 *
 * HONEST STATUS: the code paths below are written against Razorpay's published
 * API contract. Whether they have been exercised against a live account depends
 * on whether credentials are configured — run `npm run razorpay:check` to find
 * out, and see docs/RAZORPAY_INTEGRATION.md for what was actually verified.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";

export type RazorpayMode = "payouts" | "orders";

export interface RazorpayAdapterConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  /** Which API to use. `payouts` needs RazorpayX; `orders` works with any test key. */
  mode?: RazorpayMode;
  /** Source account for payouts (RazorpayX virtual account number). */
  accountNumber?: string;
  /** Request timeout. Kept short so a hung call becomes UNKNOWN quickly. */
  timeoutMs?: number;
}

/** Razorpay payout states, mapped onto ours. */
function mapPayoutStatus(status: string): ProviderPaymentStatus {
  switch (status) {
    case "processed":
      return "CONFIRMED";
    case "queued":
    case "pending":
      return "SUBMITTED";
    case "processing":
      return "ACKNOWLEDGED";
    case "cancelled":
    case "rejected":
    case "failed":
      return "FAILED";
    case "reversed":
      return "REVERSED";
    default:
      return "UNKNOWN";
  }
}

/** Razorpay order/payment states, mapped onto ours. */
function mapOrderStatus(status: string): ProviderPaymentStatus {
  switch (status) {
    case "paid":
    case "captured":
      return "CONFIRMED";
    case "created":
    case "attempted":
      return "SUBMITTED";
    case "failed":
      return "FAILED";
    default:
      return "UNKNOWN";
  }
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly razorpayCode?: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

export class RazorpayAdapter implements PaymentProvider {
  private readonly config: Required<
    Pick<RazorpayAdapterConfig, "keyId" | "keySecret" | "mode" | "timeoutMs">
  > &
    RazorpayAdapterConfig;

  constructor(config: RazorpayAdapterConfig) {
    if (!config.keyId || !config.keySecret) {
      throw new Error(
        "RazorpayAdapter requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
      );
    }

    this.config = {
      ...config,
      mode: config.mode ?? "orders",
      timeoutMs: config.timeoutMs ?? 15000,
    };
  }

  getProviderName(): string {
    return `Razorpay(${this.config.mode}${
      this.config.keyId.startsWith("rzp_test") ? ", test" : ", LIVE"
    })`;
  }

  /** True when the configured key is a test-mode key. */
  isTestMode(): boolean {
    return this.config.keyId.startsWith("rzp_test");
  }

  private authHeader(): string {
    const token = Buffer.from(
      `${this.config.keyId}:${this.config.keySecret}`
    ).toString("base64");
    return `Basic ${token}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {}
  ): Promise<T> {
    const { idempotencyKey, ...rest } = init;

    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      "Content-Type": "application/json",
      ...((rest.headers as Record<string, string>) ?? {}),
    };

    // Razorpay's idempotency header for payouts.
    if (idempotencyKey) headers["X-Payout-Idempotency"] = idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${RAZORPAY_API}${path}`, {
        ...rest,
        headers,
        signal: controller.signal,
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const error = body?.error ?? {};
        throw new RazorpayError(
          error.description ?? `Razorpay returned ${response.status}`,
          response.status,
          error.code,
          // 5xx and 429 are worth retrying with the SAME idempotency key.
          response.status >= 500 || response.status === 429
        );
      }

      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Submit a disbursement.
   *
   * A timeout here is deliberately surfaced as UNKNOWN rather than an error:
   * the request may well have been processed by Razorpay, and the caller must
   * not assume otherwise. Retrying with the same idempotency key is safe.
   */
  async createOperation(
    input: CreateOperationInput
  ): Promise<ProviderOperationResult> {
    try {
      if (this.config.mode === "payouts") {
        return await this.createPayout(input);
      }
      return await this.createOrder(input);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" ||
          (error instanceof RazorpayError && error.retryable))
      ) {
        return {
          providerPaymentId: "",
          status: "UNKNOWN",
          amountPaise: input.amountPaise,
          currency: input.currency,
          failureMode: "timeout_after_remote_success",
          failureReason:
            error.name === "AbortError"
              ? `No response within ${this.config.timeoutMs}ms - outcome unknown`
              : error.message,
          timestamp: new Date(),
        };
      }
      throw error;
    }
  }

  private async createPayout(
    input: CreateOperationInput
  ): Promise<ProviderOperationResult> {
    if (!this.config.accountNumber) {
      throw new Error(
        "Payout mode requires RAZORPAY_ACCOUNT_NUMBER (the RazorpayX virtual account)."
      );
    }

    const payout = await this.request<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      failure_reason?: string;
    }>("/payouts", {
      method: "POST",
      idempotencyKey: input.providerIdempotencyKey,
      body: JSON.stringify({
        account_number: this.config.accountNumber,
        amount: input.amountPaise,
        currency: input.currency,
        mode: "IMPS",
        purpose: "vendor bill",
        fund_account_id: input.recipientId,
        queue_if_low_balance: true,
        reference_id: input.requestFingerprint.slice(0, 40),
        narration: "Equilibrium early payment",
      }),
    });

    return {
      providerPaymentId: payout.id,
      status: mapPayoutStatus(payout.status),
      amountPaise: payout.amount,
      currency: payout.currency,
      failureReason: payout.failure_reason,
      timestamp: new Date(),
    };
  }

  private async createOrder(
    input: CreateOperationInput
  ): Promise<ProviderOperationResult> {
    const order = await this.request<{
      id: string;
      status: string;
      amount: number;
      currency: string;
    }>("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        // Razorpay rejects a duplicate receipt on the same account, which gives
        // us a coarse idempotency guarantee on this endpoint.
        receipt: input.providerIdempotencyKey.slice(0, 40),
        notes: {
          operation_type: input.operationType,
          fingerprint: input.requestFingerprint.slice(0, 40),
          supplier: input.recipientId,
        },
      }),
    });

    return {
      providerPaymentId: order.id,
      providerOrderId: order.id,
      status: mapOrderStatus(order.status),
      amountPaise: order.amount,
      currency: order.currency,
      timestamp: new Date(),
    };
  }

  /** Ask Razorpay what it believes. This is reconciliation's source of truth. */
  async getOperation(
    providerReference: string
  ): Promise<ProviderOperationResult | null> {
    try {
      if (providerReference.startsWith("pout_")) {
        const payout = await this.request<{
          id: string;
          status: string;
          amount: number;
          currency: string;
          failure_reason?: string;
        }>(`/payouts/${providerReference}`);

        return {
          providerPaymentId: payout.id,
          status: mapPayoutStatus(payout.status),
          amountPaise: payout.amount,
          currency: payout.currency,
          failureReason: payout.failure_reason,
          timestamp: new Date(),
        };
      }

      const order = await this.request<{
        id: string;
        status: string;
        amount: number;
        amount_paid: number;
        currency: string;
      }>(`/orders/${providerReference}`);

      return {
        providerPaymentId: order.id,
        providerOrderId: order.id,
        status: mapOrderStatus(order.status),
        amountPaise: order.amount,
        currency: order.currency,
        timestamp: new Date(),
      };
    } catch (error) {
      // A 404 means Razorpay has no such object - a real reconciliation finding,
      // not an error. Everything else propagates.
      if (error instanceof RazorpayError && error.httpStatus === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Verify a Razorpay webhook signature.
   *
   * Razorpay signs the raw request body with the webhook secret using
   * HMAC-SHA256 and sends the hex digest in `X-Razorpay-Signature`. The body
   * must be the exact bytes received - parsing and re-serialising changes the
   * signature.
   */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!this.config.webhookSecret) {
      // Fail closed. A missing secret means we cannot verify, so we reject.
      return false;
    }
    if (!signature) return false;

    try {
      const expected = createHmac("sha256", this.config.webhookSecret)
        .update(rawBody, "utf-8")
        .digest("hex");

      const a = Buffer.from(signature, "hex");
      const b = Buffer.from(expected, "hex");
      if (a.length !== b.length) return false;

      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Connectivity probe used by `npm run razorpay:check`. */
  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      // Listing one item is the cheapest authenticated read.
      await this.request<{ count: number }>("/orders?count=1");
      return {
        ok: true,
        detail: `Authenticated against Razorpay as ${this.config.keyId} (${
          this.isTestMode() ? "test mode" : "LIVE MODE"
        })`,
      };
    } catch (error) {
      if (error instanceof RazorpayError) {
        return {
          ok: false,
          detail: `HTTP ${error.httpStatus}${
            error.razorpayCode ? ` (${error.razorpayCode})` : ""
          }: ${error.message}`,
        };
      }
      return { ok: false, detail: (error as Error).message };
    }
  }
}

/**
 * Build an adapter from the environment, or return null when no credentials
 * are configured. Callers fall back to MockRazorpay.
 */
export function razorpayFromEnv(): RazorpayAdapter | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) return null;

  return new RazorpayAdapter({
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    mode: (process.env.RAZORPAY_API_MODE as RazorpayMode) ?? "orders",
    accountNumber: process.env.RAZORPAY_ACCOUNT_NUMBER,
  });
}
