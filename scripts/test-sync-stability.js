import { prisma } from "../src/lib/prisma.js";
import { recalculateAllPendingForCompany } from "../src/services/paymentService.js";
import { fetchAllTimeAccounts } from "../src/services/accountsService.js";

const company = await prisma.company.findFirst();
console.log("Testing sync stability (5 runs)...");

for (let i = 0; i < 5; i++) {
  await recalculateAllPendingForCompany(company.id);
  const all = await fetchAllTimeAccounts(company.id);
  console.log(
    `run ${i + 1}:`,
    "dueFromUsers",
    all.totalDueFromUsers.toFixed(2),
    "outstanding",
    all.totalOutstandingFromUsers.toFixed(2),
    "pendingDue",
    all.totalPendingDue.toFixed(2)
  );
}

await prisma.$disconnect();
