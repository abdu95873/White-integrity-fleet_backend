import { getExternalIdFromRow, getCourierNameFromRow, getCityFromRow } from "./calculations.js";
import {
  computePeriodPayment,
  findOrCreateCourier,
  getEffectiveRate,
  getEffectiveTaxAmount,
  getPreviousDue,
  toDecimal,
} from "./courierService.js";
import { prisma } from "../lib/prisma.js";

function parseOverrideNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getPreviousDuePreview(courierId, periodStart, tx = prisma) {
  const pending = await tx.paymentRecord.findFirst({
    where: {
      courierId,
      status: "pending",
      batch: { periodStart: { lt: periodStart } },
    },
    orderBy: [{ batch: { periodStart: "desc" } }, { createdAt: "desc" }],
  });

  if (!pending) return { amount: 0, referenceId: null };
  return {
    amount: Number(pending.totalPayable),
    referenceId: pending.id,
  };
}

async function lookupCourier(companyId, source, row, tx) {
  const externalId = getExternalIdFromRow(source, row);
  return tx.courier.findUnique({
    where: {
      companyId_source_externalId: { companyId, source, externalId },
    },
  });
}

function buildPreviewAmounts(source, row, commissionRate, taxAmount, previousDueAmount) {
  const { periodCalculated, commissionAmount, taxAmount: tax, grandPayment } = computePeriodPayment(
    source,
    row,
    commissionRate,
    taxAmount
  );

  const totalPayable = grandPayment + previousDueAmount;

  return {
    periodCalculated,
    commissionAmount,
    taxAmount: tax,
    grandPayment,
    totalPayable,
  };
}

export async function previewExcelUpload(params) {
  const { companyId, source, periodStart, periodEnd, rows } = params;

  const previewRows = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const externalId = getExternalIdFromRow(source, row);
    const existing = await lookupCourier(companyId, source, row, prisma);
    const isNewCourier = !existing;

    const systemCommission = existing
      ? await getEffectiveRate(existing.id, periodStart, prisma)
      : null;
    const systemTax = existing ? await getEffectiveTaxAmount(existing.id, periodStart, prisma) : null;

    const commissionRate = systemCommission ?? 0;
    const taxRate = systemTax ?? 0;

    const previousDue = existing
      ? await getPreviousDuePreview(existing.id, periodStart, prisma)
      : { amount: 0, referenceId: null };

    const amounts = buildPreviewAmounts(source, row, commissionRate, taxRate, previousDue.amount);

    previewRows.push({
      rowIndex: index,
      externalId,
      name: existing?.name ?? getCourierNameFromRow(source, row),
      city: existing?.city ?? getCityFromRow(source, row),
      isNewCourier,
      courierId: existing?.id ?? null,
      systemCommission,
      systemTax,
      commission: isNewCourier ? "" : commissionRate,
      tax: isNewCourier ? "" : taxRate,
      previousDueAmount: previousDue.amount,
      ...amounts,
      rawExcelData: row,
    });
  }

  return {
    source,
    periodStart,
    periodEnd,
    rowCount: previewRows.length,
    rows: previewRows,
  };
}

async function applyUploadCommissionRate(courierId, periodStart, periodEnd, value, isNewCourier, tx) {
  if (isNewCourier) {
    await tx.commissionHistory.create({
      data: {
        courierId,
        value: toDecimal(value),
        effectiveFrom: periodStart,
      },
    });
    return;
  }

  await tx.commissionHistory.deleteMany({
    where: { courierId, effectiveFrom: periodStart, effectiveTo: periodEnd },
  });
  await tx.commissionHistory.create({
    data: {
      courierId,
      value: toDecimal(value),
      effectiveFrom: periodStart,
      effectiveTo: periodEnd,
    },
  });
}

async function applyUploadTaxAmount(courierId, periodStart, periodEnd, value, isNewCourier, tx) {
  if (isNewCourier) {
    await tx.taxHistory.create({
      data: {
        courierId,
        value: toDecimal(value),
        effectiveFrom: periodStart,
      },
    });
    return;
  }

  await tx.taxHistory.deleteMany({
    where: { courierId, effectiveFrom: periodStart, effectiveTo: periodEnd },
  });
  await tx.taxHistory.create({
    data: {
      courierId,
      value: toDecimal(value),
      effectiveFrom: periodStart,
      effectiveTo: periodEnd,
    },
  });
}

export async function resolveUploadRates({
  companyId,
  source,
  row,
  periodStart,
  periodEnd,
  override,
  tx,
}) {
  const externalId = getExternalIdFromRow(source, row);
  const existing = await lookupCourier(companyId, source, row, tx);
  const isNewCourier = !existing;

  let courier = existing;
  if (!courier) {
    courier = await findOrCreateCourier(companyId, source, row, tx);
  } else {
    const name = getCourierNameFromRow(source, row);
    const city = getCityFromRow(source, row);
    if (courier.name !== name || courier.city !== city) {
      courier = await tx.courier.update({
        where: { id: courier.id },
        data: { name, city },
      });
    }
  }

  const asOf = periodStart;

  let commissionRate = isNewCourier ? 0 : await getEffectiveRate(courier.id, asOf, tx);
  let taxAmount = isNewCourier ? 0 : await getEffectiveTaxAmount(courier.id, asOf, tx);

  const overrideCommission = override ? parseOverrideNumber(override.commission) : null;
  const overrideTax = override ? parseOverrideNumber(override.tax) : null;

  if (isNewCourier) {
    commissionRate = overrideCommission ?? 0;
    taxAmount = overrideTax ?? 0;

    if (overrideCommission !== null) {
      await applyUploadCommissionRate(
        courier.id,
        periodStart,
        periodEnd,
        overrideCommission,
        true,
        tx
      );
    }
    if (overrideTax !== null) {
      await applyUploadTaxAmount(courier.id, periodStart, periodEnd, overrideTax, true, tx);
    }
  } else if (override) {
    if (overrideCommission !== null && overrideCommission !== commissionRate) {
      await applyUploadCommissionRate(
        courier.id,
        periodStart,
        periodEnd,
        overrideCommission,
        false,
        tx
      );
      commissionRate = overrideCommission;
    }
    if (overrideTax !== null && overrideTax !== taxAmount) {
      await applyUploadTaxAmount(courier.id, periodStart, periodEnd, overrideTax, false, tx);
      taxAmount = overrideTax;
    }
  }

  return { courier, commissionRate, taxAmount, isNewCourier, externalId };
}
