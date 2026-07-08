import { prisma } from "../src/lib/prisma.js";
import { resolveUserReceivable } from "../src/services/calculations.js";
import { toDecimal } from "../src/services/courierService.js";

const records = await prisma.paymentRecord.findMany({
  include: {
    courier: { select: { source: true, externalId: true } },
  },
});

let updated = 0;

for (const record of records) {
  const totalPayable = Number(record.totalPayable);
  const receivable = resolveUserReceivable(
    record.courier.source,
    record.rawExcelData,
    totalPayable
  );

  const stored = Number(record.userReceivableAmount ?? 0);
  if (Math.abs(stored - receivable) > 0.001) {
    await prisma.paymentRecord.update({
      where: { id: record.id },
      data: { userReceivableAmount: toDecimal(receivable) },
    });
    updated += 1;
    if (record.courier.externalId === "U932AB") {
      console.log("U932AB:", { totalPayable, receivable, stored });
    }
  }
}

console.log(`Backfilled userReceivableAmount on ${updated} of ${records.length} records`);
await prisma.$disconnect();
