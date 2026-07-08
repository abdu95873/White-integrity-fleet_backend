import { prisma } from "../src/lib/prisma.js";
import { addCommissionRate, recalculatePendingPaymentsForCourier } from "../src/services/paymentService.js";

const company = await prisma.company.findFirst();

// Courier with 2+ pending weeks
const courier = await prisma.courier.findFirst({
  where: { companyId: company.id, externalId: "4150373" },
  include: {
    paymentRecords: {
      where: { status: "pending" },
      include: { batch: true },
      orderBy: { batch: { periodStart: "asc" } },
    },
  },
});

const show = async (label) => {
  const recs = await prisma.paymentRecord.findMany({
    where: { courierId: courier.id, status: "pending" },
    include: { batch: true },
    orderBy: { batch: { periodStart: "asc" } },
  });
  console.log(label);
  for (const r of recs) {
    console.log(
      ` ${r.batch.periodStart.toISOString().slice(0, 10)}: commission=${Number(r.commissionUsed)}% payable=${Number(r.totalPayable)} prevDue=${Number(r.previousDueAmount)}`
    );
  }
};

const [week1, week2] = courier.paymentRecords;
console.log("Courier:", courier.externalId);
await show("BEFORE:");

// 10% ONLY on week1 (past pending week)
await addCommissionRate({
  courierId: courier.id,
  companyId: company.id,
  value: 10,
  periodStart: week1.batch.periodStart,
  periodEnd: week1.batch.periodEnd,
});

await show("\nAFTER 10% on week1 only (week2 rate should stay 0%):");

// Cleanup
await prisma.commissionHistory.deleteMany({
  where: { courierId: courier.id, effectiveFrom: week1.batch.periodStart, effectiveTo: week1.batch.periodEnd },
});
await prisma.$transaction((tx) => recalculatePendingPaymentsForCourier(courier.id, company.id, tx));
await show("\nAFTER cleanup (back to original):");

await prisma.$disconnect();
