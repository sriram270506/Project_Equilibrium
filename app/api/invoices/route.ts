import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/lib/auth/guard";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";
import { processInvoice } from "@/src/lib/invoices/pipeline";
import { getRiskLimits } from "@/src/lib/risk/controls";
import { errorEnvelope, successEnvelope } from "@/src/lib/api-envelope";

async function upload(request: NextRequest, _context: unknown, auth: { tenantId: string }) {
  try {
    const limits = await getRiskLimits();
    if (limits.invoiceAutoProcessingHalted) {
      return NextResponse.json(errorEnvelope("INVOICE_PROCESSING_HALTED", limits.invoiceHaltReason ?? "Invoice processing is halted"), { status: 503 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json(errorEnvelope("VALIDATION_ERROR", "file is required"), { status: 400 });
    const result = await processInvoice({ tenantId: auth.tenantId, fileName: file.name, declaredMimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined });
    return NextResponse.json(successEnvelope({ invoice: result.invoice, duplicate: result.duplicate }), { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invoice upload failed";
    return NextResponse.json(errorEnvelope("INVOICE_UPLOAD_FAILED", message), { status: 400 });
  }
}

export const POST = withRateLimit("invoiceUpload", withAuth("OPERATOR", upload), { getIdentifier: getUserIdentifier });