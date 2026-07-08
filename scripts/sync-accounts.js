import { prisma } from "../src/lib/prisma.js";
import { recalculateAllPendingForCompany } from "../src/services/paymentService.js";
import { fetchAllTimeAccounts } from "../src/services/accountsService.js";

const c = await prisma.company.findFirst();
const sync = await recalculateAllPendingForCompany(c.id);
console.log("Sync:", sync);
const all = await fetchAllTimeAccounts(c.id);
console.log("All-time:", all);
await prisma.$disconnect();
