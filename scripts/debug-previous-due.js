import { prisma } from "../src/lib/prisma.js";
import { getPreviousDue } from "../src/services/courierService.js";

const company = await prisma.company.findFirst();

const multiPending = await prisma.courier.findMany({
  where: {
    companyId: company.id,
    paymentRecords: { some: { status: "pending" } },
  },
  include: {
    paymentRecords: {
      where: { status: "pending" },
      include: { batch: true },
      orderBy: { batch: { periodStart: "asc" } },
    },
  },
});

for (const c of multiPending) {
  if (c.paymentRecords.length < 2) continue;
  console.log("\n===", c.externalId, c.source, "pending:", c.paymentRecords.length);
  for (const r of c.paymentRecords) {
    const prev = await getPreviousDue(c.id, r.batchId);
    console.log({
      period: `${r.batch.periodStart.toISOString().slice(0, 10)} - ${r.batch.periodEnd.toISOString().slice(0, 10)}`,
      totalPayable: Number(r.totalPayable),
      previousDue: Number(r.previousDueAmount),
      computedPrev: prev.amount,
      grand: Number(r.calculatedGrandPayment),
    });
  }
}

await prisma.$disconnect();
