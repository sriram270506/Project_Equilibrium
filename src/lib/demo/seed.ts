import { PrismaClient, Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "../prisma";
import {
  SUPPLIER_PROFILES,
  generateObservations,
  OBSERVATION_DAYS,
  receivableAtStakePaise,
} from "./supplier-profiles";
import { evaluateOpportunity } from "@/src/server/opportunity-service";
import { INVOICE_FIXTURES, REASON_CODE_CATALOGUE } from "./invoice-fixtures";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
  clearTenantCache,
} from "../tenancy/constants";

/**
 * Deterministic demo seed.
 *
 * Every id here is derived from a stable index rather than a random UUID, and
 * every generated number comes from a seeded PRNG. Running this twice against
 * the same reference date produces byte-identical rows — which is what makes
 * `npm run demo:verify` reproducible and lets a reviewer diff two runs.
 *
 * Randomised seeds are a reproducibility trap: a test that passes on your
 * machine and fails on a reviewer's, with no way to tell whether the code or
 * the dice changed.
 *
 * The one deliberate exception is the reference date, which defaults to today
 * at midnight UTC so the runway charts stay current. Pass an explicit date for
 * bit-for-bit determinism across days.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface SeedOptions {
  /** Wipe existing rows first. Default true. */
  reset?: boolean;
  /**
   * Anchor for generated observation dates. Defaults to today at 00:00 UTC.
   * Pass a fixed date to make the seed reproducible across days.
   */
  referenceDate?: Date;
  /**
   * Run the real model over each supplier to produce opportunities, instead of
   * inserting fabricated ones. Default true — hand-written opportunities were
   * how stale model versions and impossible feature values ended up in the
   * database.
   */
  scoreOpportunities?: boolean;
  /** Suppress console output. */
  quiet?: boolean;
}

export interface SeedResult {
  users: number;
  suppliers: number;
  observations: number;
  opportunities: number;
  recommended: number;
  rejected: number;
  disputeCases: number;
  invoices: number;
}

/** Stable, human-readable ids. `sup_001`, `obs_003_017`, and so on. */
const pad = (n: number, width = 3) => String(n).padStart(width, "0");

/**
 * Demo users and the role each holds IN the demo tenant.
 *
 * `role` is a property of the membership, not of the user, because a person can
 * be an approver in one marketplace and a viewer in another. Storing it on the
 * user would make that impossible to express and would grant privilege across
 * tenant boundaries.
 */
export const DEMO_USERS = [
  {
    id: "user_viewer",
    email: "viewer@equilibrium.demo",
    name: "Ravi Menon",
    role: "VIEWER",
    apiKey: "key_viewer_demo_12345",
  },
  {
    id: "user_operator",
    email: "priya.raman@equilibrium.demo",
    name: "Priya Raman",
    role: "OPERATOR",
    apiKey: "key_operator_demo_12345",
  },
  {
    id: "user_approver",
    email: "arjun.nair@equilibrium.demo",
    name: "Arjun Nair",
    role: "APPROVER",
    apiKey: "key_approver_demo_12345",
  },
  {
    id: "user_admin",
    email: "admin@equilibrium.demo",
    name: "Sneha Kulkarni",
    role: "ADMIN",
    apiKey: "key_admin_demo_12345",
  },
] as const;

/** Midnight UTC today, so a same-day rerun is identical. */
function defaultReferenceDate(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

/**
 * Delete all transactional and reference data, in dependency order.
 * Exported because the demo reset endpoint and the verifier both need it.
 */
export async function clearAll(db: Db = defaultPrisma): Promise<void> {
  await db.controllerTrace.deleteMany();
  await db.invoice.deleteMany();
  await db.reconciliationCase.deleteMany();
  await db.mockProviderRecord.deleteMany();
  await db.disputeDraft.deleteMany();
  await db.evidenceClaim.deleteMany();
  await db.evidenceDocument.deleteMany();
  await db.disputeCase.deleteMany();
  await db.auditEvent.deleteMany();
  await db.eventRecord.deleteMany();
  await db.outboxEvent.deleteMany();
  await db.ledgerEntry.deleteMany();
  await db.ledgerTransaction.deleteMany();
  await db.paymentIntent.deleteMany();
  await db.liquidityOpportunity.deleteMany();
  await db.liquidityObservation.deleteMany();
  await db.supplier.deleteMany();
  await db.demoScenario.deleteMany();
  await db.tenantUser.deleteMany();
  await db.user.deleteMany();
  await db.tenant.deleteMany();
  await db.riskControl.deleteMany();
  clearTenantCache();
}

/** Clear only transactional state, keeping suppliers and their history. */
export async function clearTransactionalState(
  db: Db = defaultPrisma
): Promise<void> {
  await db.reconciliationCase.deleteMany();
  await db.mockProviderRecord.deleteMany();
  await db.auditEvent.deleteMany();
  await db.eventRecord.deleteMany();
  await db.outboxEvent.deleteMany();
  await db.ledgerEntry.deleteMany();
  await db.ledgerTransaction.deleteMany();
  await db.paymentIntent.deleteMany();
  await db.liquidityOpportunity.deleteMany();
}

export async function seedDatabase(
  options: SeedOptions = {},
  db: PrismaClient = defaultPrisma as PrismaClient
): Promise<SeedResult> {
  const {
    reset = true,
    referenceDate = defaultReferenceDate(),
    scoreOpportunities = true,
    quiet = false,
  } = options;

  const log = (message: string) => {
    if (!quiet) console.log(message);
  };

  if (reset) await clearAll(db);

  /* ------------------------------------------------------------ tenant */
  await db.tenant.create({
    data: {
      id: DEFAULT_TENANT_ID,
      name: DEFAULT_TENANT_NAME,
      slug: DEFAULT_TENANT_SLUG,
    },
  });
  clearTenantCache();
  log(`Created tenant ${DEFAULT_TENANT_SLUG}`);

  /* ------------------------------------------------- users + memberships */
  for (const user of DEMO_USERS) {
    await db.user.create({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        apiKey: user.apiKey,
      },
    });

    await db.tenantUser.create({
      data: {
        id: `tu_${user.id}`,
        tenantId: DEFAULT_TENANT_ID,
        userId: user.id,
        role: user.role,
      },
    });
  }
  log(`Created ${DEMO_USERS.length} users and their tenant memberships`);

  /* --------------------------------------------- risk controls (defaults) */
  await db.riskControl.create({ data: { id: "default" } });

  /* -------------------------------------------- suppliers + observations */
  let observationCount = 0;

  for (let i = 0; i < SUPPLIER_PROFILES.length; i++) {
    const profile = SUPPLIER_PROFILES[i];
    const supplierId = `sup_${pad(i + 1)}`;

    // Backdated so relationship tenure is a real, varying feature.
    const createdAt = new Date(referenceDate);
    createdAt.setUTCDate(createdAt.getUTCDate() - (180 + i * 130));

    await db.supplier.create({
      data: {
        id: supplierId,
        tenantId: DEFAULT_TENANT_ID,
        name: profile.name,
        email: profile.email,
        riskTier: profile.riskTier,
        createdAt,
      },
    });

    const observations = generateObservations(profile, i + 1, referenceDate);
    for (let j = 0; j < observations.length; j++) {
      await db.liquidityObservation.create({
        data: {
          id: `obs_${pad(i + 1)}_${pad(j + 1)}`,
          supplierId,
          ...observations[j],
        },
      });
      observationCount++;
    }
  }

  log(
    `Created ${SUPPLIER_PROFILES.length} suppliers and ${observationCount} observations ` +
      `(${OBSERVATION_DAYS} days each)`
  );

  /* ---------------------------------------------------- opportunities */
  let recommended = 0;
  let rejected = 0;

  if (scoreOpportunities) {
    /*
     * Score through the real model rather than inserting fabricated rows.
     * Hand-written opportunities are how stale model versions and feature
     * values that the current model cannot even produce ended up in the
     * database - and a reviewer cannot tell a fabricated score from a real one.
     */
    for (let i = 0; i < SUPPLIER_PROFILES.length; i++) {
      const supplierId = `sup_${pad(i + 1)}`;

      /*
       * Receivable at stake = daily revenue x the collection cycle.
       *
       * The multiplier used to be a bare 240, which implied every supplier was
       * carrying eight months of sales in unpaid invoices. The calibrated
       * figure is the published national average of 73 days (Recordent 2026),
       * which is both defensible and the number the model was trained against.
       */
      const receivablePaise = receivableAtStakePaise(SUPPLIER_PROFILES[i]);

      const result = await evaluateOpportunity(
        supplierId,
        receivablePaise,
        undefined,
        undefined,
        `opp_${pad(i + 1)}`
      );
      if (result.status === "RECOMMENDED") recommended++;
      else rejected++;
    }
    log(
      `Scored ${SUPPLIER_PROFILES.length} suppliers through the live model: ` +
        `${recommended} recommended, ${rejected} rejected by policy`
    );
  }

  /* -------------------------------------------------- dispute evidence */
  const disputeCaseId = "dsp_001";
  await db.disputeCase.create({
    data: {
      id: disputeCaseId,
      tenantId: DEFAULT_TENANT_ID,
      providerDisputeId: "disp_demo_0001",
      reasonCode: "PRODUCT_NOT_RECEIVED",
      amountPaise: 4500000,
      status: "OPEN",
    },
  });

  const documents = [
    {
      id: "doc_001",
      documentType: "DELIVERY_PROOF",
      title: "Proof of delivery, signed",
      content:
        "Consignment CN-88214 delivered to Bengaluru warehouse gate 3 and signed for by the buyer on 14 August 2026. Recipient signature block partially legible.",
      // Signed by the counterparty, so we treat it as authoritative.
      trustedSource: true,
    },
    {
      id: "doc_002",
      documentType: "CARRIER_MANIFEST",
      title: "Third-party carrier manifest",
      content:
        "Carrier route sheet records consignment CN-88214 dropped on 17 August 2026. Route sheets are keyed in manually at end of shift.",
      // Third-party, manually keyed - lower trust, and it disagrees.
      trustedSource: false,
    },
  ];

  for (const doc of documents) {
    await db.evidenceDocument.create({
      data: {
        id: doc.id,
        disputeCaseId,
        documentType: doc.documentType,
        title: doc.title,
        content: doc.content,
        trustedSource: doc.trustedSource,
      },
    });
  }

  // Deliberately contradictory: two documents disagree on the delivery date,
  // so the draft generator must refuse to auto-submit.
  const claims = [
    {
      id: "clm_001",
      claimText: "Consignment signed for by the buyer on 14 August 2026.",
      normalizedField: "delivery_date",
      normalizedValue: "2026-08-14",
      confidence: 0.94,
      sourceDocumentId: "doc_001",
      isContradiction: false,
    },
    {
      id: "clm_002",
      claimText: "Delivery address matches the address on the order.",
      normalizedField: "delivery_address",
      normalizedValue: "match",
      confidence: 0.88,
      sourceDocumentId: "doc_001",
      isContradiction: false,
    },
    {
      id: "clm_003",
      claimText: "Carrier manifest records the drop on 17 August 2026.",
      normalizedField: "delivery_date",
      normalizedValue: "2026-08-17",
      confidence: 0.81,
      sourceDocumentId: "doc_002",
      isContradiction: true,
    },
    {
      id: "clm_004",
      claimText: "Partial legibility on the recipient signature block.",
      normalizedField: "signature_quality",
      normalizedValue: "partial",
      confidence: 0.44,
      sourceDocumentId: "doc_001",
      isContradiction: false,
    },
  ];

  for (const claim of claims) {
    await db.evidenceClaim.create({
      data: {
        ...claim,
        disputeCaseId,
        sourceSpan: "page 1",
      },
    });
  }

  log("Created 1 dispute case with 2 documents and 4 evidence claims");

  /* --------------------------------------------------------- invoices */
  /*
   * Twelve invoices with deliberate, named defects so the controller has real
   * work rather than an empty queue. Every rule they are scored against is a
   * real one - GST arithmetic, GSTIN structure, and the MSMED Act's 45-day
   * payment limit.
   */
  let invoicesCreated = 0;
  for (const fixture of INVOICE_FIXTURES) {
    const invoiceDate = new Date(referenceDate);
    invoiceDate.setUTCDate(invoiceDate.getUTCDate() - fixture.invoiceDaysAgo);

    const dueDate = new Date(invoiceDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + fixture.termsDays);

    const reasons =
      fixture.expectedReasons.length > 0
        ? fixture.expectedReasons
        : ["NO_VENDOR_HISTORY"];

    // Score from severity rather than a flat 90: a round-amount flag and a
    // duplicate payment are not the same kind of problem.
    const severityWeight: Record<string, number> = {
      HIGH: 34,
      MEDIUM: 18,
      LOW: 7,
    };
    const score = Math.min(
      95,
      12 +
        fixture.expectedReasons.reduce(
          (total, code) =>
            total + (severityWeight[REASON_CODE_CATALOGUE[code]?.severity ?? "LOW"] ?? 7),
          0
        )
    );

    const hasHigh = fixture.expectedReasons.some(
      (c) => REASON_CODE_CATALOGUE[c]?.severity === "HIGH"
    );

    await db.invoice.create({
      data: {
        id: fixture.id,
        tenantId: DEFAULT_TENANT_ID,
        sourceHash: `sha256_fixture_${fixture.id}`,
        idempotencyKey: `idem_fixture_${fixture.id}`,
        fileName: fixture.fileName,
        mimeType: "application/pdf",
        fileSizeBytes: 48_000 + invoicesCreated * 1_200,
        vendorName: fixture.vendorName,
        vendorGstin: fixture.vendorGstin,
        invoiceNumber: fixture.invoiceNumber,
        invoiceDate,
        dueDate,
        subtotalPaise: fixture.subtotalPaise,
        taxPaise: fixture.taxPaise,
        totalPaise: fixture.totalPaise,
        extractionStatus: "COMPLETE",
        validationStatus: fixture.expectedReasons.length ? "FAILED" : "PASSED",
        anomalyStatus: fixture.expectedReasons.length ? "NEEDS_REVIEW" : "OPEN",
        anomalyRisk: hasHigh
          ? "HIGH"
          : fixture.expectedReasons.length
            ? "MEDIUM"
            : "LOW",
        anomalyScore: score,
        anomalyReasonCodesJson: JSON.stringify(reasons),
        explanation: fixture.teachingNote,
        explanationStatus: "COMPLETE",
        createdAt: invoiceDate,
      },
    });
    invoicesCreated++;
  }

  log(
    `Created ${invoicesCreated} invoices (${INVOICE_FIXTURES.filter((f) => f.expectedReasons.length).length} carrying deliberate defects)`
  );

  return {
    users: DEMO_USERS.length,
    suppliers: SUPPLIER_PROFILES.length,
    observations: observationCount,
    opportunities: recommended + rejected,
    recommended,
    rejected,
    disputeCases: 1,
    invoices: invoicesCreated,
  };
}

/**
 * Seed only if the database is empty. Used by the verifier so it works against
 * a freshly created database with no manual setup step.
 */
export async function ensureSeeded(
  options: SeedOptions = {},
  db: PrismaClient = defaultPrisma as PrismaClient
): Promise<{ seeded: boolean; result?: SeedResult }> {
  const supplierCount = await db.supplier.count();
  if (supplierCount > 0) return { seeded: false };

  const result = await seedDatabase({ ...options, reset: true }, db);
  return { seeded: true, result };
}
