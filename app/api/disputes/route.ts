import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { formatPaise } from "@/src/lib/money";

/**
 * GET /api/disputes
 *
 * Dispute cases with their evidence quality summarised, so an operator can see
 * at a glance which ones are ready to submit and which contain claims that
 * contradict each other.
 */
export async function GET() {
  try {
    const cases = await prisma.disputeCase.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        evidenceClaims: true,
        evidenceDocuments: true,
        disputeDrafts: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    return NextResponse.json(
      successEnvelope({
        cases: cases.map((c) => {
          const contradictions = c.evidenceClaims.filter(
            (claim) => claim.isContradiction
          );
          const strong = c.evidenceClaims.filter(
            (claim) => !claim.isContradiction && claim.confidence >= 0.7
          );
          const weak = c.evidenceClaims.filter(
            (claim) => !claim.isContradiction && claim.confidence < 0.7
          );

          return {
            id: c.id,
            providerDisputeId: c.providerDisputeId,
            reasonCode: c.reasonCode,
            amountPaise: c.amountPaise,
            amountDisplay: formatPaise(c.amountPaise),
            status: c.status,
            createdAt: c.createdAt,
            documentCount: c.evidenceDocuments.length,
            claimCount: c.evidenceClaims.length,
            strongClaims: strong.length,
            weakClaims: weak.length,
            contradictions: contradictions.length,
            hasDraft: c.disputeDrafts.length > 0,
            draftStatus: c.disputeDrafts[0]?.validationStatus ?? null,
          };
        }),
      })
    );
  } catch (error) {
    console.error("Error fetching disputes:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to load dispute cases"),
      { status: 500 }
    );
  }
}
