export interface CreateOperationInput {
  providerIdempotencyKey: string;
  requestFingerprint: string;
  amountPaise: number;
  currency: string;
  operationType: string;
  recipientId: string;
  metadata?: Record<string, unknown>;
}

export type ProviderPaymentStatus =
  | "CREATED"
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "CONFIRMED"
  | "FAILED"
  | "REVERSED"
  | "UNKNOWN";

export interface ProviderOperationResult {
  providerPaymentId: string;
  providerOrderId?: string;
  status: ProviderPaymentStatus;
  amountPaise: number;
  currency: string;
  failureMode?: string;
  failureReason?: string;
  timestamp: Date;
}

export interface PaymentProvider {
  createOperation(
    input: CreateOperationInput
  ): Promise<ProviderOperationResult>;
  getOperation(
    providerReference: string
  ): Promise<ProviderOperationResult | null>;
  verifyWebhookSignature(
    rawBody: string,
    signature: string | null
  ): boolean;
  getProviderName(): string;
  simulateWebhook?(
    providerPaymentId: string
  ): Promise<WebhookPayload | null>;
}

export interface WebhookPayload {
  eventId: string;
  eventType: string;
  paymentId: string;
  orderId?: string;
  status: string;
  amount: number;
  currency: string;
  timestamp: string;
  signature?: string;
}
