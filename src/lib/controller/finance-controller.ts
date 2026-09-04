import { prisma } from "../prisma";
import { createAuditEvent } from "../audit";
import { checkRiskControls } from "../risk/controls";
import { evaluateOpportunity } from "@/src/server/opportunity-service";
import { generateId } from "../ids";
import { LIQUIDITY_MODEL } from "../ml/model-artifact";

export type ControllerRecommendation =
  | "REVIEW_ANOMALY"
  | "REVIEW_SUPPLIER"
  | "PROPOSE_EARLY_PAYMENT"
  | "STOPPED";

export type ControllerToolName =
  | "inspect_invoice_anomaly"
  | "find_supplier"
  | "score_supplier_liquidity"
  | "check_payment_risk";

export interface ControllerToolCall {
  name: ControllerToolName;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: "SUCCEEDED" | "STOPPED";
}

export interface ControllerRunResult {
  traceId: string;
  status: "COMPLETED" | "STOPPED";
  recommendation: ControllerRecommendation;
  stopReason: string | null;
  toolCalls: ControllerToolCall[];
  facts: Record<string, unknown>;
}

function tool<T extends Record<string, unknown>>(
  name: ControllerToolName,
  input: Record<string, unknown>,
  output: T,
  status: ControllerToolCall["status"] = "SUCCEEDED"
): ControllerToolCall {
  return { name, input, output, status };
}

/**
 * Bounded finance controller. It can observe and propose; it cannot approve,
 * submit, reconcile, or write ledger state.
 */
export async function runFinanceController(
  tenantId: string,
  invoiceId: string
): Promise<ControllerRunResult> {
  const traceId = generateId("ctrl");
  const correlationId = generateId("corr");
  const toolCalls: ControllerToolCall[] = [];
  const facts: Record<string, unknown> = {};
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });

  if (!invoice) {
    return persistResult({ traceId, correlationId, tenantId, invoiceId, status: "STOPPED", recommendation: "STOPPED", stopReason: "INVOICE_NOT_FOUND", toolCalls, facts });
  }

  const reasons = JSON.parse(invoice.anomalyReasonCodesJson) as string[];
  toolCalls.push(tool("inspect_invoice_anomaly", { invoiceId }, {
    anomalyRisk: invoice.anomalyRisk,
    anomalyStatus: invoice.anomalyStatus,
    reasonCodes: reasons,
    validationStatus: invoice.validationStatus,
    explanation: invoice.explanation ?? "explanation unavailable",
  }));
  facts.invoiceNumber = invoice.invoiceNumber;
  facts.totalPaise = invoice.totalPaise;

  if (invoice.anomalyStatus === "NEEDS_REVIEW" && invoice.anomalyRisk === "HIGH") {
    return persistResult({ traceId, correlationId, tenantId, invoiceId, status: "STOPPED", recommendation: "REVIEW_ANOMALY", stopReason: "HIGH_ANOMALY_REQUIRES_HUMAN_REVIEW", toolCalls, facts });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { tenantId, name: { equals: invoice.vendorName } },
  });
  toolCalls.push(tool("find_supplier", { vendorName: invoice.vendorName }, { supplierId: supplier?.id ?? null }));
  if (!supplier) {
    return persistResult({ traceId, correlationId, tenantId, invoiceId, status: "STOPPED", recommendation: "REVIEW_SUPPLIER", stopReason: "SUPPLIER_NOT_IDENTIFIED", toolCalls, facts });
  }

  const opportunity = await evaluateOpportunity(supplier.id, invoice.totalPaise);
  toolCalls.push(tool("score_supplier_liquidity", { supplierId: supplier.id }, {
    opportunityId: opportunity.opportunityId,
    probability: opportunity.probability,
    expectedValuePaise: opportunity.expectedValue,
    status: opportunity.status,
  }));
  facts.opportunityId = opportunity.opportunityId;
  facts.liquidityModelVersion = LIQUIDITY_MODEL.modelVersion;

  const proposedAmountPaise = Math.min(invoice.totalPaise, 500000);
  const risk = await checkRiskControls(supplier.id, proposedAmountPaise);
  toolCalls.push(tool("check_payment_risk", { supplierId: supplier.id, amountPaise: proposedAmountPaise }, {
    allowed: risk.allowed,
    requiresDualApproval: risk.requiresDualApproval,
    violations: risk.violations,
  }, risk.allowed ? "SUCCEEDED" : "STOPPED"));
  facts.proposedAmountPaise = proposedAmountPaise;

  if (opportunity.status !== "RECOMMENDED") {
    return persistResult({ traceId, correlationId, tenantId, invoiceId, status: "STOPPED", recommendation: "STOPPED", stopReason: "LIQUIDITY_POLICY_REJECTED", toolCalls, facts });
  }
  if (!risk.allowed) {
    return persistResult({ traceId, correlationId, tenantId, invoiceId, status: "STOPPED", recommendation: "STOPPED", stopReason: "PAYMENT_RISK_BLOCKED", toolCalls, facts });
  }

  return persistResult({ traceId, correlationId, tenantId, invoiceId, status: "COMPLETED", recommendation: "PROPOSE_EARLY_PAYMENT", stopReason: null, toolCalls, facts });
}

async function persistResult(input: {
  traceId: string;
  correlationId: string;
  tenantId: string;
  invoiceId: string;
  status: "COMPLETED" | "STOPPED";
  recommendation: ControllerRecommendation;
  stopReason: string | null;
  toolCalls: ControllerToolCall[];
  facts: Record<string, unknown>;
}): Promise<ControllerRunResult> {
  await prisma.controllerTrace.create({
    data: {
      id: input.traceId,
      tenantId: input.tenantId,
      invoiceId: input.invoiceId,
      runStatus: input.status,
      recommendation: input.recommendation,
      stopReason: input.stopReason,
      modelVersion: LIQUIDITY_MODEL.modelVersion,
      correlationId: input.correlationId,
      toolCallsJson: JSON.stringify(input.toolCalls),
      factsJson: JSON.stringify(input.facts),
    },
  });
  for (const call of input.toolCalls) {
    await createAuditEvent({
      tenantId: input.tenantId,
      eventType: "CONTROLLER_TOOL_CALL",
      actorType: "MODEL",
      actorId: "finance-controller",
      aggregateType: "CONTROLLER_TRACE",
      aggregateId: input.traceId,
      correlationId: input.correlationId,
      payload: {
        tool: call.name,
        input: call.input,
        output: call.output,
        status: call.status,
      },
      modelVersion: LIQUIDITY_MODEL.modelVersion,
    });
  }
  await createAuditEvent({
    tenantId: input.tenantId,
    eventType: "CONTROLLER_RUN",
    actorType: "MODEL",
    actorId: "finance-controller",
    aggregateType: "CONTROLLER_TRACE",
    aggregateId: input.traceId,
    correlationId: input.correlationId,
    payload: {
      invoiceId: input.invoiceId,
      status: input.status,
      recommendation: input.recommendation,
      stopReason: input.stopReason,
      toolCount: input.toolCalls.length,
    },
    modelVersion: LIQUIDITY_MODEL.modelVersion,
  });
  return {
    traceId: input.traceId,
    status: input.status,
    recommendation: input.recommendation,
    stopReason: input.stopReason,
    toolCalls: input.toolCalls,
    facts: input.facts,
  };
}