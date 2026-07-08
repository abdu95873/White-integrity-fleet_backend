import { prisma } from "../lib/prisma.js";
import { toDateOnlyString } from "../lib/dateOnly.js";
import { resolveUserReceivable } from "./calculations.js";
import { resolveDateRange } from "./reportService.js";

function getRecordReceivable(record) {
  const stored = Number(record.userReceivableAmount ?? 0);
  if (stored > 0) return stored;

  return resolveUserReceivable(
    record.courier.source,
    record.rawExcelData,
    Number(record.totalPayable)
  );
}

export async function fetchLatestPeriodDefaults(companyId) {
  const batch = await prisma.paymentBatch.findFirst({
    where: { companyId },
    orderBy: { periodEnd: "desc" },
  });

  if (!batch) {
    const now = new Date();
    const weekEnd = toDateOnlyString(now);
    const start = parseDateOnlyForDefaults(weekEnd);
    start.setDate(start.getDate() - 6);
    return {
      period: "weekly",
      weekStart: toDateOnlyString(start),
      weekEnd,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    };
  }

  return {
    period: "weekly",
    weekStart: toDateOnlyString(batch.periodStart),
    weekEnd: toDateOnlyString(batch.periodEnd),
    month: batch.periodEnd.getUTCMonth() + 1,
    year: batch.periodEnd.getUTCFullYear(),
  };
}

function parseDateOnlyForDefaults(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function fetchAccountsSummary(params) {
  const { companyId, period, month, year, weekStart, weekEnd, source } = params;
  const { start, end } = resolveDateRange({ period, month, year, weekStart, weekEnd });

  const where = {
    courier: {
      companyId,
      ...(source ? { source } : {}),
    },
    batch: {
      periodStart: { lte: end },
      periodEnd: { gte: start },
    },
  };

  const records = await prisma.paymentRecord.findMany({
    where,
    include: {
      courier: { select: { id: true, name: true, externalId: true, source: true } },
      batch: { select: { periodStart: true, periodEnd: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const summary = {
    commissionProfit: 0,
    taxCollected: 0,
    grossVolume: 0,
    dueFromUsers: 0,
    outstandingFromUsers: 0,
    pendingDue: 0,
    paidOut: 0,
    pendingCount: 0,
    paidCount: 0,
    receivableCount: 0,
    totalRecords: records.length,
  };

  const byCourier = new Map();
  const receivableCouriers = [];

  for (const record of records) {
    const commission = Number(record.commissionAmount ?? 0);
    const tax = Number(record.taxAmount ?? 0);
    const gross = Number(record.periodCalculated);
    const payable = Number(record.totalPayable);
    const receivable = getRecordReceivable(record);

    summary.commissionProfit += commission;
    summary.taxCollected += tax;
    summary.grossVolume += gross;
    summary.dueFromUsers += receivable;

    if (receivable > 0) {
      summary.receivableCount += 1;
      if (record.status === "pending") {
        summary.outstandingFromUsers += receivable;
      }
    }

    if (record.status === "pending") {
      if (payable > 0) summary.pendingDue += payable;
      summary.pendingCount += 1;
    } else if (payable > 0) {
      summary.paidOut += payable;
      summary.paidCount += 1;
    }

    const existing = byCourier.get(record.courierId) ?? {
      courierId: record.courier.id,
      name: record.courier.name,
      externalId: record.courier.externalId,
      source: record.courier.source,
      commissionProfit: 0,
      dueFromUsers: 0,
      outstandingFromUsers: 0,
      pendingDue: 0,
      paidOut: 0,
      recordCount: 0,
    };

    existing.commissionProfit += commission;
    existing.dueFromUsers += receivable;
    existing.recordCount += 1;
    if (receivable > 0 && record.status === "pending") {
      existing.outstandingFromUsers += receivable;
    }
    if (record.status === "pending" && payable > 0) existing.pendingDue += payable;
    else if (payable > 0) existing.paidOut += payable;

    byCourier.set(record.courierId, existing);

    if (receivable > 0) {
      receivableCouriers.push({
        courierId: record.courier.id,
        name: record.courier.name,
        externalId: record.courier.externalId,
        source: record.courier.source,
        amount: receivable,
        status: record.status,
        periodStart: record.batch.periodStart,
        periodEnd: record.batch.periodEnd,
      });
    }
  }

  return {
    range: { start, end },
    summary,
    byCourier: Array.from(byCourier.values()).sort(
      (a, b) => b.dueFromUsers - a.dueFromUsers || b.commissionProfit - a.commissionProfit
    ),
    receivableCouriers: receivableCouriers.sort((a, b) => b.amount - a.amount),
  };
}

export async function fetchAllTimeAccounts(companyId) {
  const records = await prisma.paymentRecord.findMany({
    where: { courier: { companyId } },
    include: {
      courier: { select: { source: true } },
    },
  });

  let totalCommissionProfit = 0;
  let totalTaxCollected = 0;
  let totalGrossVolume = 0;
  let totalDueFromUsers = 0;
  let totalOutstandingFromUsers = 0;
  let totalPendingDue = 0;
  let pendingCommissionProfit = 0;
  let pendingCount = 0;

  for (const record of records) {
    const commission = Number(record.commissionAmount ?? 0);
    const tax = Number(record.taxAmount ?? 0);
    const gross = Number(record.periodCalculated);
    const payable = Number(record.totalPayable);
    const receivable = getRecordReceivable(record);

    totalCommissionProfit += commission;
    totalTaxCollected += tax;
    totalGrossVolume += gross;
    totalDueFromUsers += receivable;

    if (receivable > 0 && record.status === "pending") {
      totalOutstandingFromUsers += receivable;
    }

    if (record.status === "pending") {
      pendingCount += 1;
      pendingCommissionProfit += commission;
      if (payable > 0) totalPendingDue += payable;
    }
  }

  return {
    totalCommissionProfit,
    totalTaxCollected,
    totalGrossVolume,
    totalDueFromUsers,
    totalOutstandingFromUsers,
    totalPendingDue,
    pendingCommissionProfit,
    pendingCount,
    totalRecords: records.length,
  };
}

export async function fetchOutstandingReceivables(companyId) {
  const records = await prisma.paymentRecord.findMany({
    where: {
      courier: { companyId },
      status: "pending",
    },
    include: {
      courier: { select: { id: true, name: true, externalId: true, source: true } },
      batch: { select: { periodStart: true, periodEnd: true } },
    },
    orderBy: { batch: { periodStart: "desc" } },
  });

  return records
    .map((record) => {
      const amount = getRecordReceivable(record);
      if (amount <= 0) return null;
      return {
        courierId: record.courier.id,
        name: record.courier.name,
        externalId: record.courier.externalId,
        source: record.courier.source,
        amount,
        totalPayable: Number(record.totalPayable),
        periodStart: record.batch.periodStart,
        periodEnd: record.batch.periodEnd,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.amount - a.amount);
}
