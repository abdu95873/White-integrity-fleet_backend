import { prisma } from "../src/lib/prisma.js";
import {
  fetchAccountsSummary,
  fetchAllTimeAccounts,
  fetchOutstandingReceivables,
  fetchLatestPeriodDefaults,
} from "../src/services/accountsService.js";

const company = await prisma.company.findFirst();
if (!company) {
  console.log("No company");
  process.exit(0);
}

const defaults = await fetchLatestPeriodDefaults(company.id);
const allTime = await fetchAllTimeAccounts(company.id);
const outstanding = await fetchOutstandingReceivables(company.id);
const weekly = await fetchAccountsSummary({
  companyId: company.id,
  period: "weekly",
  weekStart: defaults.weekStart,
  weekEnd: defaults.weekEnd,
});
const june = await fetchAccountsSummary({
  companyId: company.id,
  period: "weekly",
  weekEnd: "2026-06-28",
});

console.log("defaults", defaults);
console.log("allTime", allTime);
console.log("outstanding count", outstanding.length, "total", outstanding.reduce((s, r) => s + r.amount, 0));
console.log("weekly (defaults)", weekly.summary);
console.log("june week", june.summary);
console.log("weekly range label mismatch check:");
console.log("  batch latest:", await prisma.paymentBatch.findFirst({
  where: { companyId: company.id },
  orderBy: { periodEnd: "desc" },
  select: { periodStart: true, periodEnd: true },
}));
console.log("  filter range:", weekly.range);

await prisma.$disconnect();
