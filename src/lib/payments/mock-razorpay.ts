import {
  CreateOperationInput,
  PaymentProvider,
  ProviderOperationResult,
  WebhookPayload,
} from "./provider-types";
import { generateId } from "../ids";
import { prisma } from "../prisma";

export type FailureMode =
  | "success"
  | "timeout_after_remote_success"
  | "timeout_before_processing"
  | "provider_decline"
  | "duplicate_webhook"
  | "delayed_webhook"
  | "malformed_webhook";

/**
 * Mock Razorpay provider for demo and testing
 * Simulates provider behavior including failures and race conditions
 */
export class MockRazorpay implements PaymentProvider {
  private failureMode: FailureMode = "success";
  private simulatedLatencyMs: number = 0;

  constructor() {
    console.log("🧪 MockRazorpay provider initialized");
  }

  getProviderName(): string {
    return "MockRazorpay";
  }

  /**
   * Set the failure mode for next operation
   */
  setFailureMode(mode: FailureMode): void {
    this.failureMode = mode;
  }

  /**
   * Set simulated latency
   */
  setLatency(ms: number): void {
    this.simulatedLatencyMs = ms;
  }

  /**
   * Set whether next webhook should be duplicated
   */
  setShouldDuplicateWebhook(_shouldDuplicate: boolean): void {
    // This would be used for failure injection scenarios
  }

  /**
   * Create a payment operation
   */
  async createOperation(
    input: CreateOperationInput
  ): Promise<ProviderOperationResult> {
    // Add simulated latency
    if (this.simulatedLatencyMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.simulatedLatencyMs)
      );
    }

    const providerPaymentId = `pay_demo_${generateId().slice(0, 20)}`;
    const providerOrderId = `ord_demo_${generateId().slice(0, 20)}`;

    // Check for idempotency conflicts (by idempotency key)
    const existingRecord = await prisma.mockProviderRecord.findUnique({
      where: { providerIdempotencyKey: input.providerIdempotencyKey },
    });

    if (existingRecord) {
      // Idempotent retry
      return {
        providerPaymentId: existingRecord.providerPaymentId,
        providerOrderId: existingRecord.providerOrderId || undefined,
        status: (existingRecord.status as any) || "CONFIRMED",
        amountPaise: existingRecord.amountPaise,
        currency: "INR",
        failureMode: existingRecord.failureMode || undefined,
        timestamp: new Date(),
      };
    }

    // Simulate provider operation
    const now = new Date();
    let status = "CONFIRMED";
    let failureReason: string | undefined;

    if (this.failureMode === "timeout_after_remote_success") {
      // Provider confirms but we don't see it
      status = "CONFIRMED";
      // In real scenario, this would timeout on client
    } else if (this.failureMode === "timeout_before_processing") {
      status = "UNKNOWN";
      failureReason = "Simulated timeout before provider processed";
    } else if (this.failureMode === "provider_decline") {
      status = "FAILED";
      failureReason = "Provider declined transaction";
    } else {
      status = "CONFIRMED";
    }

    // Store in mock provider record for reconciliation
    // Key: providerPaymentId (what we return), also store idempotency key for dedup
    await prisma.mockProviderRecord.create({
      data: {
        id: generateId(),
        providerPaymentId,
        providerIdempotencyKey: input.providerIdempotencyKey,
        providerOrderId,
        amountPaise: input.amountPaise,
        status,
        failureMode: this.failureMode,
        webhookSent: false,
      },
    });

    this.failureMode = "success"; // Reset for next operation
    this.simulatedLatencyMs = 0;

    return {
      providerPaymentId,
      providerOrderId,
      status: status as any,
      amountPaise: input.amountPaise,
      currency: input.currency,
      failureMode: failureReason ? this.failureMode : undefined,
      failureReason,
      timestamp: now,
    };
  }

  /**
   * Get operation status
   */
  async getOperation(
    providerReference: string
  ): Promise<ProviderOperationResult | null> {
    const record = await prisma.mockProviderRecord.findUnique({
      where: { providerPaymentId: providerReference },
    });

    if (!record) {
      return null;
    }

    return {
      providerPaymentId: record.providerPaymentId,
      providerOrderId: record.providerOrderId || undefined,
      status: (record.status as any) || "CONFIRMED",
      amountPaise: record.amountPaise,
      currency: "INR",
      failureMode: record.failureMode || undefined,
      timestamp: new Date(),
    };
  }

  /**
   * Verify webhook signature (mock: always true in demo mode)
   */
  verifyWebhookSignature(
    _rawBody: string,
    _signature: string | null
  ): boolean {
    // In demo mode, all webhooks are accepted
    return true;
  }

  /**
   * Simulate a provider webhook
   */
  async simulateWebhook(
    providerPaymentId: string
  ): Promise<WebhookPayload | null> {
    const record = await prisma.mockProviderRecord.findUnique({
      where: { providerPaymentId },
    });

    if (!record) {
      return null;
    }

    const payload: WebhookPayload = {
      eventId: `evt_demo_${generateId().slice(0, 20)}`,
      eventType: "payment.confirmed",
      paymentId: record.providerPaymentId,
      orderId: record.providerOrderId || undefined,
      status: record.status,
      amount: record.amountPaise,
      currency: "INR",
      timestamp: new Date().toISOString(),
      signature: `sig_demo_${generateId().slice(0, 40)}`,
    };

    // Mark webhook as sent
    await prisma.mockProviderRecord.update({
      where: { providerPaymentId },
      data: { webhookSent: true },
    });

    return payload;
  }
}

export const mockRazorpay = new MockRazorpay();
