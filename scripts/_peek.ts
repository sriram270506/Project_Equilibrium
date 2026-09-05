import { prisma } from "../src/lib/prisma";
async function main() {
  const rows = await prisma.liquidityOpportunity.findMany({
    orderBy: { expectedBenefitPaise: "desc" },
    select: { id: true, expectedBenefitPaise: true, status: true, decisionReason: true },
  });
  console.log("threshold 7500000, per-txn cap 15000000");
  for (const r of rows) console.log(`${r.id}  ${String(r.expectedBenefitPaise).padStart(9)}  ${r.status.padEnd(12)} ${(r.decisionReason ?? "").slice(0,80)}`);
  await prisma.$disconnect();
}
main();
