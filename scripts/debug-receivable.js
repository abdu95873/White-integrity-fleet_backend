import { prisma } from "../src/lib/prisma.js";
import { resolveUserReceivable, getUserReceivableFromRow } from "../src/services/calculations.js";

const externalId = process.argv[2] || "U932AB";

const courier = await prisma.courier.findFirst({
  where: { externalId: { contains: externalId, mode: "insensitive" } },
  include: {
    paymentRecords: {
      include: { batch: true },
      orderBy: { createdAt: "desc" },
    },
  },
});

if (!courier) {
  console.log("Courier not found for", externalId);
  process.exit(0);
}

console.log("Courier:", courier.name, courier.externalId, courier.source);

for (const r of courier.paymentRecords) {
  const row = r.rawExcelData;
  const receivable = resolveUserReceivable(courier.source, row, Number(r.totalPayable));
  const fromExcel = getUserReceivableFromRow(courier.source, row);

  console.log("\n--- Record", r.id);
  console.log("Period:", r.batch.periodStart.toISOString().slice(0, 10), "-", r.batch.periodEnd.toISOString().slice(0, 10));
  console.log("periodCalculated:", Number(r.periodCalculated));
  console.log("totalPayable:", Number(r.totalPayable));
  console.log("userReceivableAmount DB:", Number(r.userReceivableAmount));
  console.log("computed receivable:", receivable);
  console.log("fromExcel only:", fromExcel);
  console.log("status:", r.status);

  console.log("All raw row keys/values:");
  for (const [k, v] of Object.entries(row)) {
    console.log(`  ${k}:`, JSON.stringify(v));
  }
}

await prisma.$disconnect();
