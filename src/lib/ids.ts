import { v4 as uuidv4 } from "uuid";

export function generateId(prefix: string = ""): string {
  const id = uuidv4();
  if (prefix) {
    return `${prefix}_${id}`;
  }
  return id;
}

export function generatePaymentId(): string {
  return generateId("pay_demo");
}

export function generateOrderId(): string {
  return generateId("ord_demo");
}

export function generateCorrelationId(): string {
  return generateId("corr");
}

export function generateIdempotencyKey(): string {
  return generateId("idem");
}

export function maskIdempotencyKey(key: string): string {
  if (key.length <= 8) return "****";
  return "****" + key.slice(-4);
}
