import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/lib/auth/guard";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";
import {
  costInvoiceAnomalies,
  summarisePreventedLoss,
  counterfactualsFor,
} from "@/src/lib/invoices/economics";
import { withRateLimit, getUserIdentifier } from "@/src/lib/api/rate-limit-middleware";
import { processInvoice } from "@/src/lib/invoices/pipeline";
import { getRiskLimits } from "@/src/lib/risk/controls";

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

/**
 * GET /api/invoices
 *
 * The queue, priced. Every anomaly is costed in rupees so the list can be
 * ordered by money at risk rather than by an abstract severity label, and so
 * an operator can see what reviewing this queue is actually worth.
 */
const list = async (
  _request: NextRequest,
  _context: unknown,
  auth: { tenantId: string }
) => {
  const tenantId = auth.tenantId;

  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const forCosting = invoices.map((i) => ({
    subtotalPaise: i.subtotalPaise,
    taxPaise: i.taxPaise,
    totalPaise: i.totalPaise,
    invoiceDate: i.invoiceDate,
    dueDate: i.dueDate,
    reasonCodes: JSON.parse(i.anomalyReasonCodesJson) as string[],
  }));

  const rollup = summarisePreventedLoss(forCosting);

  return NextResponse.json(
    successEnvelope({
      summary: {
        ...rollup,
        exactPreventedDisplay: formatPaise(rollup.exactPreventedPaise),
        totalPreventedDisplay: formatPaise(rollup.totalPreventedPaise),
      },
      invoices: invoices.map((invoice, index) => {
        const costs = costInvoiceAnomalies(forCosting[index]);
        return {
          id: invoice.id,
          vendorName: invoice.vendorName,
          vendorGstin: invoice.vendorGstin,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          totalPaise: invoice.totalPaise,
          totalDisplay: formatPaise(invoice.totalPaise),
          taxPaise: invoice.taxPaise,
          anomalyRisk: invoice.anomalyRisk,
          anomalyScore: invoice.anomalyScore,
          anomalyStatus: invoice.anomalyStatus,
          reasonCodes: forCosting[index].reasonCodes,
          explanation: invoice.explanation,
          // Terms, so an MSMED breach is visible in the list itself.
          termsDays: invoice.dueDate
            ? Math.round(
                (invoice.dueDate.getTime() - invoice.invoiceDate.getTime()) /
                  86_400_000
              )
            : null,
          counterfactuals: counterfactualsFor(forCosting[index]),
          exposure: {
            exactPaise: costs.exactExposurePaise,
            totalPaise: costs.totalExposurePaise,
            exactDisplay: formatPaise(costs.exactExposurePaise),
            totalDisplay: formatPaise(costs.totalExposurePaise),
            costs: costs.costs,
          },
        };
      }),
    })
  );
};

export const GET = withAuth("VIEWER", list);
