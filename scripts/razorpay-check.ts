/**
 * Razorpay connectivity check.
 *
 *   npm run razorpay:check
 *
 * Proves — or disproves — that this project can actually talk to Razorpay with
 * the credentials in your environment. It creates a real Order in Test Mode,
 * reads it back, and verifies webhook signature handling against a locally
 * computed HMAC.
 *
 * This exists because "we have a provider adapter" is not evidence. Either this
 * script prints a Razorpay object id that a reviewer can look up in the
 * dashboard, or it tells you exactly why it could not.
 */

import { createHmac } from "crypto";
import { razorpayFromEnv } from "../src/lib/payments/razorpay-adapter";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("Razorpay integration check");
  console.log("==========================\n");

  const adapter = razorpayFromEnv();

  if (!adapter) {
    console.log("No Razorpay credentials found in the environment.\n");
    console.log("To run this check against Razorpay Test Mode:");
    console.log("  1. Sign in at https://dashboard.razorpay.com and switch to Test Mode");
    console.log("  2. Settings > API Keys > Generate Test Key");
    console.log("  3. Put them in .env:");
    console.log("       RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx");
    console.log("       RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx");
    console.log("       RAZORPAY_MODE=live");
    console.log("  4. Re-run: npm run razorpay:check\n");
    console.log(
      "The application runs fully against MockRazorpay without these, but the\n" +
        "live integration is unproven until this script passes."
    );
    process.exitCode = 0; // Not a failure - just unconfigured.
    return;
  }

  /* ------------------------------------------------------ safety first */
  console.log("1. Credentials\n");

  check(
    "Key is a TEST key, not a live one",
    adapter.isTestMode(),
    adapter.isTestMode()
      ? "rzp_test_… — safe"
      : "This looks like a LIVE key. Refusing to continue."
  );

  if (!adapter.isTestMode()) {
    console.log(
      "\nRefusing to run against live credentials. This is a prototype.\n"
    );
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------------ connectivity */
  console.log("\n2. Connectivity\n");

  const ping = await adapter.ping();
  check("Authenticated against api.razorpay.com", ping.ok, ping.detail);

  if (!ping.ok) {
    console.log("\nCannot continue without a working connection.\n");
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------- create a real object */
  console.log("\n3. Create a real Razorpay object\n");

  const idempotencyKey = `eqcheck_${Date.now()}`;
  const created = await adapter.createOperation({
    providerIdempotencyKey: idempotencyKey,
    requestFingerprint: "connectivity-check",
    amountPaise: 100000, // Rs 1,000
    currency: "INR",
    operationType: "DISCOUNT_PAYOUT",
    recipientId: "sup_check",
  });

  check(
    "Razorpay accepted the request and returned an id",
    Boolean(created.providerPaymentId),
    created.providerPaymentId || "no id returned"
  );
  check(
    "Amount round-trips exactly",
    created.amountPaise === 100000,
    `sent 100000 paise, got ${created.amountPaise}`
  );

  console.log(
    `\n  → Look this up in your Razorpay dashboard: ${created.providerPaymentId}\n`
  );

  /* ------------------------------------------------------- read back */
  console.log("4. Read it back (this is what reconciliation does)\n");

  const fetched = await adapter.getOperation(created.providerPaymentId);
  check("Razorpay returns the object we just created", fetched !== null);
  check(
    "Amount agrees between create and fetch",
    fetched?.amountPaise === created.amountPaise,
    `${created.amountPaise} vs ${fetched?.amountPaise}`
  );

  /* ------------------------------------------- unknown object handling */
  console.log("\n5. Missing objects are a finding, not a crash\n");

  const missing = await adapter.getOperation("order_DoesNotExist000");
  check(
    "A non-existent object returns null rather than throwing",
    missing === null,
    "reconciliation reports MISSING_EXTERNAL"
  );

  /* --------------------------------------------------- webhook signing */
  console.log("\n6. Webhook signature verification\n");

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.log(
      "  SKIP  RAZORPAY_WEBHOOK_SECRET not set. Set it to verify signing.\n"
    );
  } else {
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_test", amount: 100000 } } },
    });
    const validSignature = createHmac("sha256", secret)
      .update(body, "utf-8")
      .digest("hex");

    check(
      "A correctly signed webhook is accepted",
      adapter.verifyWebhookSignature(body, validSignature)
    );
    check(
      "A tampered body is rejected",
      !adapter.verifyWebhookSignature(body + " ", validSignature)
    );
    check(
      "A wrong signature is rejected",
      !adapter.verifyWebhookSignature(body, "f".repeat(64))
    );
    check(
      "A missing signature is rejected",
      !adapter.verifyWebhookSignature(body, null)
    );
  }

  /* ------------------------------------------------------------ done */
  console.log("\n" + "=".repeat(46));
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log("=".repeat(46));

  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log(
      "\nLive Razorpay integration verified against Test Mode.\n" +
        `Object created: ${created.providerPaymentId}`
    );
  }
}

main().catch((error) => {
  console.error("\nCheck crashed:", error);
  process.exitCode = 1;
});
