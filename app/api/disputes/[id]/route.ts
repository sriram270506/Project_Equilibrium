import { prisma } from "@/src/lib/prisma";
import { successEnvelope, errorEnvelope } from "@/src/lib/api-envelope";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const disputeCase = await prisma.disputeCase.findUnique({
      where: { id },
      include: {
        evidenceDocuments: {
          include: {
            evidenceClaims: true,
          },
        },
        disputeDrafts: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!disputeCase) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", "Dispute case not found"),
        { status: 404 }
      );
    }

    return NextResponse.json(
      successEnvelope({
        id: disputeCase.id,
        providerDisputeId: disputeCase.providerDisputeId,
        reasonCode: disputeCase.reasonCode,
        amountPaise: disputeCase.amountPaise,
        status: disputeCase.status,
        createdAt: disputeCase.createdAt,
        updatedAt: disputeCase.updatedAt,
        evidence: disputeCase.evidenceDocuments.map((doc) => ({
          id: doc.id,
          documentType: doc.documentType,
          title: doc.title,
          content: doc.content,
          trustedSource: doc.trustedSource,
          claims: doc.evidenceClaims.map((claim) => ({
            id: claim.id,
            claimText: claim.claimText,
            normalizedField: claim.normalizedField,
            normalizedValue: claim.normalizedValue,
            confidence: claim.confidence,
            sourceSpan: claim.sourceSpan,
            isContradiction: claim.isContradiction,
          })),
        })),
        latestDraft: disputeCase.disputeDrafts[0]
          ? {
              id: disputeCase.disputeDrafts[0].id,
              draftText: disputeCase.disputeDrafts[0].draftText,
              validationStatus: disputeCase.disputeDrafts[0].validationStatus,
              validationErrors: disputeCase.disputeDrafts[0]
                .validationErrorsJson
                ? JSON.parse(disputeCase.disputeDrafts[0].validationErrorsJson)
                : [],
              createdAt: disputeCase.disputeDrafts[0].createdAt,
            }
          : null,
      })
    );
  } catch (error) {
    console.error("Error fetching dispute:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed to fetch dispute"),
      { status: 500 }
    );
  }
}
