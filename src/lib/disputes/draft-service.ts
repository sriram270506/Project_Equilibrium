import { prisma } from "../prisma";
import { generateId } from "../ids";

/**
 * Generate dispute draft from evidence claims
 */
export async function generateDisputeDraft(
  disputeCaseId: string,
  createdBy: string = "system"
) {
  const disputeCase = await prisma.disputeCase.findUnique({
    where: { id: disputeCaseId },
    include: {
      evidenceClaims: true,
      evidenceDocuments: true,
    },
  });

  if (!disputeCase) {
    throw new Error(`Dispute case not found: ${disputeCaseId}`);
  }

  // Collect validated claims
  const validClaims = disputeCase.evidenceClaims.filter(
    (c) => !c.isContradiction && c.confidence >= 0.7
  );

  const contradictions = disputeCase.evidenceClaims.filter(
    (c) => c.isContradiction
  );

  // Validation checks
  const validationErrors: string[] = [];

  if (validClaims.length === 0) {
    validationErrors.push("No high-confidence claims found");
  }

  if (contradictions.length > 0) {
    validationErrors.push(
      `Found ${contradictions.length} contradictory claims`
    );
  }

  // Generate draft template
  let draftText = `Dispute Case: ${disputeCase.id}\n`;
  draftText += `Reason: ${disputeCase.reasonCode}\n`;
  draftText += `Amount: ₹${disputeCase.amountPaise / 100}\n\n`;
  draftText += `## Evidence Summary\n\n`;

  for (const claim of validClaims) {
    draftText += `- [${(claim.confidence * 100).toFixed(0)}%] ${claim.claimText}\n`;
  }

  if (contradictions.length > 0) {
    draftText += `\n## Contradictory Evidence\n\n`;
    for (const claim of contradictions) {
      draftText += `- ⚠️  ${claim.claimText}\n`;
    }
  }

  const draftId = generateId();
  const validationStatus =
    validationErrors.length === 0
      ? "PASSED"
      : contradictions.length > 0
        ? "NEEDS_REVIEW"
        : "FAILED";

  await prisma.disputeDraft.create({
    data: {
      id: draftId,
      disputeCaseId,
      draftText,
      claimIdsJson: JSON.stringify(validClaims.map((c) => c.id)),
      validationStatus,
      validationErrorsJson:
        validationErrors.length > 0
          ? JSON.stringify(validationErrors)
          : null,
      createdBy,
    },
  });

  // Update dispute case status
  await prisma.disputeCase.update({
    where: { id: disputeCaseId },
    data: {
      status:
        validationStatus === "PASSED"
          ? "DRAFT_READY"
          : "NEEDS_REVIEW",
    },
  });

  return {
    draftId,
    validationStatus,
    validationErrors,
    draftText,
  };
}

/**
 * Get draft for dispute case
 */
export async function getDisputeDraft(disputeCaseId: string) {
  return prisma.disputeDraft.findFirst({
    where: { disputeCaseId },
    orderBy: { createdAt: "desc" },
  });
}
