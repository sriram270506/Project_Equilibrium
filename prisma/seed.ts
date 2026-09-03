/**
 * Prisma seed entry point.
 *
 * All the logic lives in src/lib/demo/seed.ts so the CLI seed, the demo reset
 * endpoint, and the verifier share one implementation. Three copies that
 * drifted apart was how the reset endpoint ended up creating six observations
 * while the CLI created a hundred and eighty.
 */

import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/demo/seed";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Equilibrium demo data...\n");

  // Optional fixed anchor for bit-for-bit reproducibility across days:
  //   SEED_REFERENCE_DATE=2026-09-01 npm run db:seed
  const anchor = process.env.SEED_REFERENCE_DATE;
  const referenceDate = anchor ? new Date(anchor + "T00:00:00.000Z") : undefined;

  if (anchor && Number.isNaN(referenceDate?.getTime())) {
    throw new Error(
      "SEED_REFERENCE_DATE must be an ISO date such as 2026-09-01, got: " + anchor
    );
  }

  const result = await seedDatabase({ referenceDate }, prisma);

  console.log("\nSeed complete:");
  console.log("  users          " + result.users);
  console.log("  suppliers      " + result.suppliers);
  console.log("  observations   " + result.observations);
  console.log(
    "  opportunities  " + result.opportunities +
    " (" + result.recommended + " recommended, " + result.rejected + " rejected)"
  );
  console.log("  dispute cases  " + result.disputeCases);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
