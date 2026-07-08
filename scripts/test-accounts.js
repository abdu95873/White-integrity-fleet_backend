import { prisma } from "../src/lib/prisma.js";
import { fetchAccountsSummary, fetchLatestPeriodDefaults } from "../src/services/accountsService.js";

const company = await prisma.company.findFirst();
if (!company) {
  console.log("no company");
  process.exit(0);
}
console.log("company", company.slug);

const defaults = await fetchLatestPeriodDefaults(company.id);
console.log("defaults", defaults);

const withWeek = await fetchAccountsSummary({
  companyId: company.id,
  period: "weekly",
  weekEnd: defaults.weekEnd,
});
console.log(
  "with defaults weekEnd records:",
  withWeek.summary.totalRecords,
  "byCourier:",
  withWeek.byCourier.length
);
console.log("range", withWeek.range);

const noWeek = await fetchAccountsSummary({ companyId: company.id, period: "weekly" });
console.log("no weekEnd records:", noWeek.summary.totalRecords);

const batches = await prisma.paymentBatch.findMany({
  where: { companyId: company.id },
  select: { periodStart: true, periodEnd: true, source: true },
  orderBy: { periodEnd: "desc" },
  take: 3,
});
console.log("latest batches", batches);

const juneWeek = await fetchAccountsSummary({
  companyId: company.id,
  period: "weekly",
  weekEnd: "2026-06-28",
});
console.log(
  "june 22-28 week records:",
  juneWeek.summary.totalRecords,
  "byCourier:",
  juneWeek.byCourier.length
);

await prisma.$disconnect();
