import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import {
  calculateBoltPayment,
  calculateGlovoPayment,
  getCityFromRow,
  getCourierNameFromRow,
  getExternalIdFromRow,
} from "./calculations.js";

export function resolveDisplayRate(history) {
  if (!history?.length) return 0;

  const open = history.find((record) => record.effectiveTo === null);
  if (open) return Number(open.value);

  const latestWeek = [...history].sort(
    (a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
  )[0];
  return latestWeek ? Number(latestWeek.value) : 0;
}

export async function getEffectiveRate(courierId, asOf, tx) {
  const client = tx ?? prisma;

  const record = await client.commissionHistory.findFirst({
    where: {
      courierId,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (record) return Number(record.value);

  return getCurrentCommissionRate(courierId, tx);
}

export async function getCurrentCommissionRate(courierId, tx) {
  const client = tx ?? prisma;

  const open = await client.commissionHistory.findFirst({
    where: { courierId, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
  });
  if (open) return Number(open.value);

  const latestWeek = await client.commissionHistory.findFirst({
    where: { courierId, effectiveTo: { not: null } },
    orderBy: { effectiveFrom: "desc" },
  });
  return latestWeek ? Number(latestWeek.value) : 0;
}

async function getTaxRecord(tx, courierId, asOf) {
  const client = tx ?? prisma;

  return client.taxHistory.findFirst({
    where: {
      courierId,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

export async function getEffectiveTaxAmount(courierId, asOf, tx) {
  const record = await getTaxRecord(tx, courierId, asOf);
  if (record) return Number(record.value);

  return getCurrentTaxAmount(courierId, tx);
}

export async function getCurrentTaxAmount(courierId, tx) {
  const client = tx ?? prisma;

  const open = await client.taxHistory.findFirst({
    where: { courierId, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
  });
  if (open) return Number(open.value);

  const latestWeek = await client.taxHistory.findFirst({
    where: { courierId, effectiveTo: { not: null } },
    orderBy: { effectiveFrom: "desc" },
  });
  return latestWeek ? Number(latestWeek.value) : 0;
}

export async function getPreviousDue(courierId, beforeBatchId, tx) {
  const client = tx ?? prisma;

  if (!beforeBatchId) {
    return { amount: 0, referenceId: null };
  }

  const currentBatch = await client.paymentBatch.findUnique({
    where: { id: beforeBatchId },
    select: { periodStart: true },
  });

  if (!currentBatch) {
    return { amount: 0, referenceId: null };
  }

  // Most recent pending payroll period strictly before the current batch.
  const pending = await client.paymentRecord.findFirst({
    where: {
      courierId,
      status: "pending",
      batchId: { not: beforeBatchId },
      batch: {
        periodStart: { lt: currentBatch.periodStart },
      },
    },
    orderBy: [{ batch: { periodStart: "desc" } }, { createdAt: "desc" }],
  });

  if (!pending) return { amount: 0, referenceId: null };
  return {
    amount: Number(pending.totalPayable),
    referenceId: pending.id,
  };
}

export async function findOrCreateCourier(companyId, source, row, tx = prisma) {
  const externalId = getExternalIdFromRow(source, row);
  const name = getCourierNameFromRow(source, row);
  const city = getCityFromRow(source, row);

  let courier = await tx.courier.findUnique({
    where: {
      companyId_source_externalId: { companyId, source, externalId },
    },
  });

  if (!courier) {
    courier = await tx.courier.create({
      data: { companyId, source, externalId, name, city },
    });
  } else if (courier.name !== name || courier.city !== city) {
    courier = await tx.courier.update({
      where: { id: courier.id },
      data: { name, city },
    });
  }

  return courier;
}

export function computePeriodPayment(source, row, commissionRate, taxAmount) {
  return source === "glovo"
    ? calculateGlovoPayment(row, commissionRate, taxAmount)
    : calculateBoltPayment(row, commissionRate, taxAmount);
}

export function toDecimal(value) {
  return new Decimal(value.toFixed(2));
}
