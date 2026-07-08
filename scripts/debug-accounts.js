import { prisma } from "../src/lib/prisma.js";
import { recalculatePendingPaymentsForCourier } from "../src/services/paymentService.js";
import { resolveUserReceivable } from "../src/services/calculations.js";

const r = await prisma.paymentRecord.findFirst({
  where: { courier: { externalId: "U932AB" } },
  include: {
    courier: {
      include: {
        commissionHistory: { where: { effectiveTo: null } },
        taxHistory: { where: { effectiveTo: null } },
      },
    },
  },
});

console.log("U932AB before:", {
  commissionUsed: Number(r.commissionUsed),
  commissionAmount: Number(r.commissionAmount),
  taxAmount: Number(r.taxAmount),
  periodCalculated: Number(r.periodCalculated),
  totalPayable: Number(r.totalPayable),
  userReceivable: Number(r.userReceivableAmount),
  rates: {
    commission: r.courier.commissionHistory[0] ? Number(r.courier.commissionHistory[0].value) : 0,
    tax: r.courier.taxHistory[0] ? Number(r.courier.taxHistory[0].value) : 0,
  },
});

// Count zero commission records
const zeroCommission = await prisma.paymentRecord.count({
  where: { commissionAmount: 0, periodCalculated: { gt: 0 } },
});
console.log("Records with 0 commission but positive calculated:", zeroCommission);

// Sample glovo receivable
const glovo = await prisma.paymentRecord.findFirst({
  where: { courier: { externalId: "4150361" } },
  include: { courier: true },
});
if (glovo) {
  console.log("Glovo 4150361 receivable from row:", resolveUserReceivable(
    glovo.courier.source,
    glovo.rawExcelData,
    Number(glovo.totalPayable)
  ));
  console.log("dailyCash:", glovo.rawExcelData["Plata zilnica cu cash"]);
  console.log("totalAdjustments:", glovo.rawExcelData["Ajustari Totale"]);
}

await prisma.$disconnect();
