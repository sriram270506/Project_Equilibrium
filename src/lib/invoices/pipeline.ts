import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { createAuditEvent } from "../audit";
import { ConflictError, ServiceUnavailableError, ValidationError } from "../errors";
import { addPaise, subtractPaise } from "../money";
import { generateId } from "../ids";
import { stripImageMetadata, validateUploadedFile, AllowedMimeType } from "../upload/hardening";
import { getExplanationProvider, getExtractionProvider } from "./ai-providers";

export interface ExtractedInvoice {
  vendorName: string;
  vendorGstin: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface DocumentExtractionProvider {
  extract(bytes: Uint8Array, mimeType: AllowedMimeType): Promise<ExtractedInvoice>;
}

export const mockExtractionProvider: DocumentExtractionProvider = {
  async extract(bytes) {
    const text = new TextDecoder().decode(bytes);
    const match = (name: string, fallback: string) =>
      text.match(new RegExp(`${name}[:=]([^\\n;]+)`, "i"))?.[1]?.trim() ?? fallback;
    const subtotalPaise = Number(match("subtotalPaise", "100000"));
    const taxPaise = Number(match("taxPaise", "18000"));
    return {
      vendorName: match("vendorName", "Demo Vendor"),
      vendorGstin: match("gstin", "27ABCDE1234F1Z5").toUpperCase(),
      invoiceNumber: match("invoiceNumber", "INV-DEMO-001"),
      invoiceDate: new Date(match("invoiceDate", "2026-09-01")),
      dueDate: new Date(match("dueDate", "2026-09-30")),
      subtotalPaise,
      taxPaise,
      totalPaise: Number(match("totalPaise", String(addPaise(subtotalPaise, taxPaise)))),
    };
  },
};

export function validateGstin(gstin: string): boolean {
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let factor = 2;
  let sum = 0;
  for (let index = gstin.length - 2; index >= 0; index -= 1) {
    const product = chars.indexOf(gstin[index]) * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  const check = (36 - (sum % 36)) % 36;
  return chars[check] === gstin[gstin.length - 1];
}

function validateExtracted(invoice: ExtractedInvoice): string[] {
  const reasons: string[] = [];
  if (!validateGstin(invoice.vendorGstin)) reasons.push("INVALID_GSTIN");
  if (Number.isNaN(invoice.invoiceDate.getTime())) reasons.push("INVALID_INVOICE_DATE");
  if (invoice.dueDate && invoice.dueDate < invoice.invoiceDate) reasons.push("DUE_DATE_BEFORE_INVOICE");
  try {
    if (addPaise(invoice.subtotalPaise, invoice.taxPaise) !== invoice.totalPaise ||
        subtractPaise(invoice.totalPaise, invoice.taxPaise) !== invoice.subtotalPaise) {
      reasons.push("ARITHMETIC_MISMATCH");
    }
  } catch {
    reasons.push("ARITHMETIC_MISMATCH");
  }
  if (invoice.subtotalPaise < 0 || invoice.taxPaise < 0 || invoice.totalPaise < 0) reasons.push("NEGATIVE_AMOUNT");
  return reasons;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new ServiceUnavailableError("Explanation unavailable")), timeoutMs)),
  ]);
}

export async function explainInvoice(invoice: ExtractedInvoice, reasons: string[]): Promise<string> {
  try {
    return await withTimeout(getExplanationProvider().explain({ invoice, reasons }), 2500);
  } catch {
    return "explanation unavailable";
  }
}

export async function processInvoice(input: {
  tenantId: string;
  fileName: string;
  declaredMimeType: string;
  bytes: Uint8Array;
  idempotencyKey?: string;
}): Promise<{ invoice: Awaited<ReturnType<typeof prisma.invoice.findUniqueOrThrow>>; duplicate: boolean }> {
  const validated = validateUploadedFile(input.bytes, input.fileName, input.declaredMimeType);
  const normalizedBytes = stripImageMetadata(input.bytes, validated.mimeType);
  const sourceHash = createHash("sha256").update(normalizedBytes).digest("hex");
  if (!input.idempotencyKey) throw new ValidationError("Idempotency-Key header is required");
  const idempotencyKey = input.idempotencyKey;
  const byKey = await prisma.invoice.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (byKey) return { invoice: byKey, duplicate: true };
  const existing = await prisma.invoice.findUnique({ where: { sourceHash } });
  if (existing) return { invoice: existing, duplicate: true };

  const extracted = await getExtractionProvider().extract(normalizedBytes, validated.mimeType);
  const reasons = validateExtracted(extracted);
  const similar = await prisma.invoice.findFirst({
    where: {
      tenantId: input.tenantId,
      vendorGstin: extracted.vendorGstin,
      totalPaise: extracted.totalPaise,
      invoiceDate: { gte: new Date(extracted.invoiceDate.getTime() - 30 * 24 * 60 * 60 * 1000) },
    },
  });
  if (similar) reasons.push("SIMILAR_INVOICE");
  const risk = reasons.length > 0 ? "HIGH" : "MEDIUM";
  const status = reasons.length > 0 ? "NEEDS_REVIEW" : "OPEN";
  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          id: generateId("inv"), tenantId: input.tenantId, sourceHash,
          idempotencyKey,
          fileName: validated.sanitizedFileName, mimeType: validated.mimeType,
          fileSizeBytes: normalizedBytes.length, vendorName: extracted.vendorName,
          vendorGstin: extracted.vendorGstin, invoiceNumber: extracted.invoiceNumber,
          invoiceDate: extracted.invoiceDate, dueDate: extracted.dueDate,
          subtotalPaise: extracted.subtotalPaise, taxPaise: extracted.taxPaise,
          totalPaise: extracted.totalPaise, extractionStatus: "COMPLETE",
          validationStatus: reasons.length ? "FAILED" : "PASSED", anomalyStatus: status,
          anomalyRisk: risk, anomalyScore: reasons.length ? 90 : 50,
          anomalyReasonCodesJson: JSON.stringify(reasons.length ? reasons : ["NO_VENDOR_HISTORY"]),
        },
      });
      await createAuditEvent({ tenantId: input.tenantId, eventType: "INVOICE_ANOMALY_OPENED", actorType: "SYSTEM", actorId: "invoice-pipeline", aggregateType: "INVOICE", aggregateId: created.id, payload: { from: null, to: status, reasons }, }, tx);
      return created;
    });
    const explanation = await explainInvoice(extracted, reasons.length ? reasons : ["NO_VENDOR_HISTORY"]);
    const updated = await prisma.invoice.update({ where: { id: invoice.id }, data: { explanation, explanationStatus: "COMPLETE" } });
    return { invoice: updated, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.invoice.findUniqueOrThrow({ where: { sourceHash } });
      return { invoice: duplicate, duplicate: true };
    }
    throw error;
  }
}

export async function transitionAnomaly(invoiceId: string, tenantId: string, to: "ACKNOWLEDGED" | "CLEARED") {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!invoice) throw new ValidationError("Invoice not found");
  if (invoice.anomalyStatus !== "OPEN") throw new ConflictError("Anomaly is already resolved");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { anomalyStatus: to } });
    await createAuditEvent({ tenantId, eventType: `INVOICE_ANOMALY_${to}`, actorType: "OPERATOR", actorId: "invoice-reviewer", aggregateType: "INVOICE", aggregateId: invoiceId, payload: { from: "OPEN", to }, }, tx);
    return updated;
  });
}