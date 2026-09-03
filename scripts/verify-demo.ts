/**
 * End-to-end self-check.
 *
 *   npm run demo:verify
 *
 * Drives the real services through the whole story - score, approve, pay,
 * survive two injected provider failures, reconcile, prove - and asserts the
 * invariants at each step. Exits non-zero if any of them fails.
 *
 * The point is that every claim this project makes should be checkable by
 * running one command, rather than believed because a README says so.
 */

import { PrismaClient } from "@prisma/client";
import {
  evaluateOpportunity,
  approveOpportunity,
  confirmSecondApproval,
} from "../src/server/opportunity-service";
import {
  submitPaymentToProvider,
  simulateWebhook,
} from "../src/lib/payments/payment-service";
import { mockRazorpay, FailureMode } from "../src/lib/payments/mock-razorpay";
import { runFullReconciliation } from "../src/lib/reconciliation/reconciliation-service";
import { publishPendingEvents } from "../src/lib/events/event-service";
import { calculateTrialBalance } from "../src/lib/ledger/trial-balance";
import { verifyAuditChain } from "../src/lib/audit";
import { setKillSwitch, getRiskLimits } from "../src/lib/risk/controls";
import { LIQUIDITY_MODEL } from "../src/lib/ml/model-artifact";
import { ensureSeeded, clearTransactionalState } from "../src/lib/demo/seed";
import { OBSERVATION_DAYS } from "../src/lib/demo/supplier-profiles";
import { scopedQueries } from "../src/lib/tenancy/scoped-queries";
import { resolveInternalTenantId } from "../src/lib/tenancy/constants";

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(description: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${description}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(description);
    console.log(`  FAIL  ${description}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

const rupees = (paise: number) =>
  `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

async function main() {
  console.log("Equilibrium end-to-end verification");
  console.log("===================================");

  /* ------------------------------------------------------- clean state */
  section("1. Prepare the database");

  /*
   * Seed if empty, so this works against a database that has only just been
   * created. Requiring a manual `npm run db:seed` first meant the verifier
   * failed on a fresh clone - the exact situation a reviewer is in.
   */
  const { seeded } = await ensureSeeded({ quiet: true }, prisma);
  console.log(
    seeded
      ? "  Database was empty - seeded it."
      : "  Database already has suppliers - reusing them."
  );

  await clearTransactionalState(prisma);
  await setKillSwitch(false, "verify-script");

  const suppliers = await prisma.supplier.findMany();
  const observations = await prisma.liquidityObservation.count();

  check("Suppliers exist", suppliers.length > 0, `${suppliers.length} suppliers`);
  check(
    "Every supplier has cash-flow history",
    // Explicit non-zero floor. `observations >= suppliers.length * 10` passed
    // vacuously at 0 >= 0 on an empty database, hiding the real failure.
    observations > 0 && observations >= suppliers.length * OBSERVATION_DAYS,
    `${observations} observations across ${suppliers.length} suppliers`
  );

  /* ------------------------------------------------------------ model */
  section("2. Model is fitted and beats the baseline");

  const test = LIQUIDITY_MODEL.metrics.test;
  const baseline = LIQUIDITY_MODEL.metrics.baseline;

  check(
    "Model beats the runway<7d baseline on held-out AUC",
    test.auc > baseline.auc,
    `${test.auc.toFixed(3)} vs ${baseline.auc.toFixed(3)}`
  );
  check(
    "Recall is high enough to be useful",
    test.recall >= 0.8,
    `${(test.recall * 100).toFixed(0)}%`
  );
  check(
    "Model is more precise than the naive rule",
    test.precision > baseline.precision,
    `${(test.precision * 100).toFixed(0)}% vs ${(baseline.precision * 100).toFixed(0)}%`
  );
  check(
    "Cash coverage lowers predicted risk (sign sanity)",
    LIQUIDITY_MODEL.coefficients.balanceCoverage < 0,
    `coefficient ${LIQUIDITY_MODEL.coefficients.balanceCoverage.toFixed(3)}`
  );
  check(
    "Runway pressure raises predicted risk (sign sanity)",
    LIQUIDITY_MODEL.coefficients.runwayPressure > 0,
    `coefficient ${LIQUIDITY_MODEL.coefficients.runwayPressure.toFixed(3)}`
  );

  /* ----------------------------------------------------------- scoring */
  section("3. Score every supplier");

  let recommended = 0;
  let rejected = 0;
  for (const supplier of suppliers) {
    const hasObservation = await prisma.liquidityObservation.findFirst({
      where: { supplierId: supplier.id },
    });
    if (!hasObservation) continue;
    const result = await evaluateOpportunity(supplier.id, 15000000);
    if (result.status === "RECOMMENDED") recommended++;
    else rejected++;
  }

  check("At least one supplier was flagged", recommended > 0, `${recommended} offers`);
  check(
    "Policy rejected some suppliers rather than approving everyone",
    rejected > 0,
    `${rejected} rejected`
  );

  /* ---------------------------------------------------- happy-path pay */
  section("4. Approve and pay");

  const firstOffer = await prisma.liquidityOpportunity.findFirst({
    where: { status: "RECOMMENDED" },
    orderBy: { predictionProbability: "asc" }, // smallest first, avoids dual-approval
  });
  if (!firstOffer) throw new Error("No offer to approve");

  const approval = await approveOpportunity(firstOffer.id, "verify-maker");
  mockRazorpay.setFailureMode("success");

  let status = approval.status;
  if (!approval.requiresDualApproval) {
    status = await submitPaymentToProvider(approval.paymentIntentId);
  }

  check(
    "Payment reached a terminal success state",
    status === "CONFIRMED" || approval.requiresDualApproval,
    `status ${status}`
  );

  const ledgerTxn = await prisma.ledgerTransaction.findFirst({
    where: { paymentIntentId: approval.paymentIntentId },
    include: { entries: true },
  });
  const txnDebits = ledgerTxn?.entries.reduce((s, e) => s + e.debitPaise, 0) ?? 0;
  const txnCredits = ledgerTxn?.entries.reduce((s, e) => s + e.creditPaise, 0) ?? 0;

  const accountsTouched = new Set(
    ledgerTxn?.entries.map((e) => e.accountCode) ?? []
  );

  check(
    "A full journal was posted with the payment",
    accountsTouched.size >= 4,
    `${ledgerTxn?.entries.length ?? 0} legs across ${accountsTouched.size} accounts`
  );
  check(
    "The discount is recorded as income, not just as a cash movement",
    accountsTouched.has("DISCOUNT_INCOME")
  );
  check(
    "Provider fees and cost of capital are posted as expenses",
    accountsTouched.has("PROVIDER_FEE_EXPENSE") &&
      accountsTouched.has("FUNDING_COST_EXPENSE")
  );
  check(
    "Those entries balance",
    txnDebits === txnCredits,
    `${rupees(txnDebits)} = ${rupees(txnCredits)}`
  );

  /* ------------------------------------------------ injected timeout */
  section("5. Survive a provider timeout");

  /*
   * Deliberately pick an offer ABOVE the dual-approval threshold, so the
   * maker-checker path is exercised every run. Picking whatever happened to be
   * next meant those three checks silently vanished on some runs - a check that
   * only sometimes runs is not a check.
   */
  const riskLimits = await getRiskLimits();
  const secondOffer =
    (await prisma.liquidityOpportunity.findFirst({
      where: {
        status: "RECOMMENDED",
        expectedBenefitPaise: { gte: riskLimits.dualApprovalThresholdPaise },
      },
      orderBy: { expectedBenefitPaise: "asc" },
    })) ??
    (await prisma.liquidityOpportunity.findFirst({
      where: { status: "RECOMMENDED" },
      orderBy: { predictionProbability: "asc" },
    }));

  check(
    "An offer above the dual-approval threshold exists to test with",
    secondOffer !== null &&
      secondOffer.expectedBenefitPaise >= riskLimits.dualApprovalThresholdPaise,
    secondOffer
      ? `${rupees(secondOffer.expectedBenefitPaise)} vs threshold ${rupees(riskLimits.dualApprovalThresholdPaise)}`
      : "no offers remain"
  );

  if (secondOffer) {
    const timeoutApproval = await approveOpportunity(secondOffer.id, "verify-maker");

    // Large advances are held for a second approver. Clear that gate first,
    // testing maker-checker on the way, so the timeout is genuinely exercised
    // rather than skipped past.
    if (timeoutApproval.requiresDualApproval) {
      check(
        "Large advances are held for a second approver",
        timeoutApproval.status === "PENDING_APPROVAL",
        `${rupees(secondOffer.expectedBenefitPaise)} is above the ${rupees(timeoutApproval.dualApprovalThresholdPaise)} threshold`
      );

      let selfApprovalRefused = false;
      try {
        await confirmSecondApproval(timeoutApproval.paymentIntentId, "verify-maker");
      } catch (error) {
        selfApprovalRefused = (error as Error).message.includes("different person");
      }
      check(
        "The maker cannot approve their own payment",
        selfApprovalRefused
      );

      await confirmSecondApproval(timeoutApproval.paymentIntentId, "verify-checker");

      const afterCheck = await prisma.paymentIntent.findUnique({
        where: { id: timeoutApproval.paymentIntentId },
      });
      check(
        "A different operator can release it",
        afterCheck?.status === "INTENT_CREATED" &&
          afterCheck?.checkerId === "verify-checker"
      );
    }

    mockRazorpay.setFailureMode("timeout_after_remote_success" as FailureMode);
    const timeoutStatus = await submitPaymentToProvider(
      timeoutApproval.paymentIntentId
    );

    check(
      "A timeout is recorded as UNKNOWN, not guessed either way",
      timeoutStatus === "UNKNOWN",
      `status ${timeoutStatus}`
    );

    // The provider really did commit it - that divergence is the point.
    const payment = await prisma.paymentIntent.findUnique({
      where: { id: timeoutApproval.paymentIntentId },
    });
    if (payment?.providerPaymentId) {
      const providerRecord = await prisma.mockProviderRecord.findUnique({
        where: { providerPaymentId: payment.providerPaymentId },
      });
      check(
        "Our view and the provider's genuinely diverge",
        providerRecord?.status === "CONFIRMED" && payment.status === "UNKNOWN",
        `we say ${payment.status}, provider says ${providerRecord?.status}`
      );
    }
  } else {
    console.log("  SKIP  no second offer available for the timeout case");
  }

  /* -------------------------------------------- duplicate webhook */
  section("6. Survive a duplicated webhook");

  const confirmed = await prisma.paymentIntent.findFirst({
    where: { status: "CONFIRMED", providerPaymentId: { not: null } },
  });

  if (confirmed) {
    const before = await prisma.eventRecord.count();
    await simulateWebhook(confirmed.id);
    await simulateWebhook(confirmed.id);
    const after = await prisma.eventRecord.count();

    check(
      "A replayed webhook creates no new event records",
      after === before,
      `${after - before} net new records`
    );

    const stillConfirmed = await prisma.paymentIntent.findUnique({
      where: { id: confirmed.id },
    });
    check(
      "The payment state is unchanged by the replay",
      stillConfirmed?.status === "CONFIRMED"
    );
  } else {
    console.log("  SKIP  no confirmed payment to receive a webhook");
  }

  /* ------------------------------------------------- reconciliation */
  section("7. Reconcile against the provider");

  const unknownBefore = await prisma.paymentIntent.count({
    where: { status: "UNKNOWN" },
  });
  await runFullReconciliation();
  const unknownAfter = await prisma.paymentIntent.count({
    where: { status: "UNKNOWN" },
  });

  check(
    "Reconciliation resolved every unknown payment",
    unknownAfter === 0,
    `${unknownBefore} before, ${unknownAfter} after`
  );

  const criticalOpen = await prisma.reconciliationCase.count({
    where: { severity: "CRITICAL", status: { in: ["OPEN", "INVESTIGATING"] } },
  });
  check("No critical exceptions remain open", criticalOpen === 0);

  /* --------------------------------------------------------- outbox */
  section("8. Drain the outbox");

  const pendingBefore = await prisma.outboxEvent.count({
    where: { status: "PENDING" },
  });
  await publishPendingEvents();
  const pendingAfter = await prisma.outboxEvent.count({
    where: { status: "PENDING" },
  });

  check(
    "Every pending outbox event was published exactly once",
    pendingAfter === 0,
    `${pendingBefore} drained`
  );

  const eventRecords = await prisma.eventRecord.findMany({
    select: { idempotencyKey: true },
  });
  const uniqueKeys = new Set(eventRecords.map((e) => e.idempotencyKey));
  check(
    "Event log contains no duplicate idempotency keys",
    uniqueKeys.size === eventRecords.length,
    `${eventRecords.length} events, ${uniqueKeys.size} unique`
  );

  /* --------------------------------------------------------- ledger */
  section("9. The books foot");

  const trialBalance = await calculateTrialBalance();
  check(
    "Total debits equal total credits after two injected failures",
    trialBalance.balanced,
    `${rupees(trialBalance.totalDebits)} = ${rupees(trialBalance.totalCredits)}`
  );
  check("Net position is exactly zero", trialBalance.net === 0);

  /* ---------------------------------------------------- audit chain */
  section("10. The audit chain verifies");

  const chain = await verifyAuditChain();
  check(
    "Every audit entry hashes correctly and links to its predecessor",
    chain.valid,
    `${chain.entriesChecked} entries checked`
  );

  /* --------------------------------------------------- risk controls */
  section("11. Risk controls actually block");

  // Make sure there is something to block, rather than depending on leftovers.
  let subject = await prisma.liquidityOpportunity.findFirst({
    where: { status: "RECOMMENDED" },
  });

  if (!subject) {
    for (const supplier of suppliers) {
      const hasObservation = await prisma.liquidityObservation.findFirst({
        where: { supplierId: supplier.id },
      });
      if (!hasObservation) continue;
      const result = await evaluateOpportunity(supplier.id, 15000000);
      if (result.status === "RECOMMENDED") {
        subject = await prisma.liquidityOpportunity.findUnique({
          where: { id: result.opportunityId },
        });
        break;
      }
    }
  }

  await setKillSwitch(true, "verify-script", "Verification test");

  if (subject) {
    let blocked = false;
    let reason = "";
    try {
      await approveOpportunity(subject.id, "verify-maker");
    } catch (error) {
      blocked = (error as Error).name === "RiskControlError";
      reason = (error as Error).message;
    }
    check(
      "The kill switch refuses new payments while engaged",
      blocked,
      blocked ? reason.slice(0, 60) : "the payment was NOT blocked"
    );
  } else {
    check(
      "The kill switch refuses new payments while engaged",
      false,
      "could not produce an offer to test against"
    );
  }

  await setKillSwitch(false, "verify-script");
  const limits = await getRiskLimits();
  check("The kill switch released cleanly", limits.killSwitchEngaged === false);

  /* ---------------------------------------------------- concurrency */
  section("12. Concurrent approvals cannot double-pay");

  const raceOffer = await prisma.liquidityOpportunity.findFirst({
    where: { status: "RECOMMENDED" },
    orderBy: { expectedBenefitPaise: "asc" },
  });

  if (raceOffer) {
    const paymentsBefore = await prisma.paymentIntent.count({
      where: { supplierId: raceOffer.supplierId },
    });

    // Ten callers race for the same offer. Exactly one may win.
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        approveOpportunity(raceOffer.id, `race-operator-${i}`)
      )
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled").length;
    const paymentsAfter = await prisma.paymentIntent.count({
      where: { supplierId: raceOffer.supplierId },
    });
    const created = paymentsAfter - paymentsBefore;

    check(
      "Exactly one of ten concurrent approvals succeeds",
      succeeded === 1,
      `${succeeded} succeeded, ${10 - succeeded} rejected`
    );
    check(
      "Exactly one payment intent is created",
      created === 1,
      `${created} created`
    );

    const raceBalance = await calculateTrialBalance();
    check(
      "The ledger still balances after the race",
      raceBalance.balanced,
      `${rupees(raceBalance.totalDebits)} = ${rupees(raceBalance.totalCredits)}`
    );
  } else {
    check(
      "Exactly one of ten concurrent approvals succeeds",
      false,
      "no offer available to race"
    );
  }

  /* ------------------------------------------------ tenant isolation */
  section("13. One tenant cannot see another's data");

  /*
   * Multi-tenancy is only worth anything if it is enforced. Creating a second
   * tenant with its own supplier and confirming the scoped queries refuse to
   * cross the boundary is the only way to know the tenantId columns are
   * actually being applied rather than merely present.
   */
  const OTHER_TENANT = "tenant_isolation_probe";

  await prisma.tenant.deleteMany({ where: { id: OTHER_TENANT } });
  await prisma.tenant.create({
    data: {
      id: OTHER_TENANT,
      name: "Rival Marketplace",
      slug: "rival-marketplace-probe",
    },
  });

  await prisma.supplier.create({
    data: {
      id: "sup_rival_001",
      tenantId: OTHER_TENANT,
      name: "Rival Tenant Supplier",
      email: "rival@example.test",
      riskTier: "LOW",
    },
  });

  const homeTenantId = await resolveInternalTenantId();

  const ourSuppliers = await scopedQueries.findSuppliers(homeTenantId);
  const theirSuppliers = await scopedQueries.findSuppliers(OTHER_TENANT);
  const allSuppliers = await prisma.supplier.count();

  check(
    "A scoped supplier query returns only this tenant's rows",
    ourSuppliers.every((s) => s.tenantId === homeTenantId) &&
      ourSuppliers.length < allSuppliers,
    `${ourSuppliers.length} of ${allSuppliers} total`
  );

  check(
    "The other tenant sees only its own supplier",
    theirSuppliers.length === 1 && theirSuppliers[0].id === "sup_rival_001"
  );

  check(
    "Fetching another tenant's record by id returns nothing",
    (await scopedQueries.findSupplierById(homeTenantId, "sup_rival_001")) === null,
    "no cross-tenant read even with a known id"
  );

  const ourPayments = await scopedQueries.findPayments(homeTenantId);
  const theirPayments = await scopedQueries.findPayments(OTHER_TENANT);

  check(
    "Payments are scoped too",
    ourPayments.length > 0 && theirPayments.length === 0,
    `${ourPayments.length} ours, ${theirPayments.length} theirs`
  );

  const ourOpportunities = await scopedQueries.findOpportunities(homeTenantId);
  check(
    "Opportunities are scoped and inherit the supplier's tenant",
    ourOpportunities.length > 0 &&
      ourOpportunities.every((o) => o.tenantId === homeTenantId)
  );

  // Clean up the probe so the demo database is left as it was found.
  await prisma.supplier.deleteMany({ where: { tenantId: OTHER_TENANT } });
  await prisma.tenant.delete({ where: { id: OTHER_TENANT } });

  /* --------------------------------------------------------- summary */
  console.log("\n" + "=".repeat(46));
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log("=".repeat(46));

  if (failed > 0) {
    console.log("\nFailed checks:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\nEverything this project claims, verified end to end.");
  }
}

main()
  .catch((error) => {
    console.error("\nVerification crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
