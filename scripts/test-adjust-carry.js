import { prisma } from "../src/lib/prisma.js";
import { addCommissionRate, recalculatePendingPaymentsForCourier } from "../src/services/paymentService.js";

const company = await prisma.company.findFirst();

// Find a courier that has a PAID record and a later PENDING record
const courier = await prisma.courier.findFirst({
  where: {
    companyId: company.id,
    paymentRecords: { some: { status: "paid" } },
  },
  include: {
    paymentRecords: {
      include: { batch: true },
      orderBy: { batch: { periodStart: "asc" } },
    },
  },
});

if (!courier) {
  console.log("No courier with paid record found");
  process.exit(0);
}

const paid = courier.paymentRecords.find((r) => r.status === "paid");
const pendingAfter = courier.paymentRecords.find(
  (r) => r.status === "pending" && r.batch.periodStart > paid.batch.periodStart
);

console.log("Courier:", courier.externalId, courier.source);
console.log("Paid week:", paid.batch.periodStart.toISOString().slice(0, 10), "-", paid.batch.periodEnd.toISOString().slice(0, 10));
console.log("Paid record before:", {
  commissionUsed: Number(paid.commissionUsed),
  totalPayable: Number(paid.totalPayable),
});
if (pendingAfter) {
  console.log("Pending week after:", pendingAfter.batch.periodStart.toISOString().slice(0, 10));
  console.log("Pending before:", {
    totalPayable: Number(pendingAfter.totalPayable),
    adjustment: Number(pendingAfter.adjustmentAmount),
  });
} else {
  console.log("No pending record after paid week");
}

// Apply 5% commission ONLY to the paid week
await addCommissionRate({
  courierId: courier.id,
  companyId: company.id,
  value: 5,
  periodStart: paid.batch.periodStart,
  periodEnd: paid.batch.periodEnd,
});

const paidAfterUpdate = await prisma.paymentRecord.findUnique({ where: { id: paid.id } });
console.log("\nPaid record after rate change (should be UNCHANGED):", {
  commissionUsed: Number(paidAfterUpdate.commissionUsed),
  totalPayable: Number(paidAfterUpdate.totalPayable),
});

const adjustments = await prisma.paymentAdjustment.findMany({
  where: { courierId: courier.id },
});
console.log("\nAdjustments created:", adjustments.map((a) => ({
  amount: Number(a.amount),
  reason: a.reason,
  appliedTo: a.appliedToRecordId ? "applied" : "unapplied",
})));

if (pendingAfter) {
  const pendingUpdated = await prisma.paymentRecord.findUnique({ where: { id: pendingAfter.id } });
  console.log("\nPending after carry:", {
    totalPayable: Number(pendingUpdated.totalPayable),
    adjustment: Number(pendingUpdated.adjustmentAmount),
    prevDue: Number(pendingUpdated.previousDueAmount),
  });
}

// Stability: run recalc 3 more times, totals must not drift
for (let i = 0; i < 3; i++) {
  await prisma.$transaction((tx) => recalculatePendingPaymentsForCourier(courier.id, company.id, tx));
  const recs = await prisma.paymentRecord.findMany({
    where: { courierId: courier.id, status: "pending" },
    include: { batch: true },
    orderBy: { batch: { periodStart: "asc" } },
  });
  console.log(
    `stability run ${i + 1}:`,
    recs.map((r) => `${r.batch.periodStart.toISOString().slice(5, 10)}: payable=${Number(r.totalPayable)} adj=${Number(r.adjustmentAmount)}`).join(" | ")
  );
}

// Cleanup: revert test rate + adjustments so real data is not polluted
await prisma.commissionHistory.deleteMany({
  where: { courierId: courier.id, effectiveFrom: paid.batch.periodStart, effectiveTo: paid.batch.periodEnd },
});
await prisma.paymentAdjustment.deleteMany({ where: { courierId: courier.id } });
await prisma.$transaction((tx) => recalculatePendingPaymentsForCourier(courier.id, company.id, tx));
console.log("\nCleanup done — test rate and adjustments removed.");

await prisma.$disconnect();
