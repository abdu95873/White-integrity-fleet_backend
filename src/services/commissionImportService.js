import { prisma } from "../lib/prisma.js";
import { runTransaction } from "../lib/transaction.js";
import { buildCourierRow } from "./commissionListParser.js";
import {
  findOrCreateCourier,
  getCurrentCommissionRate,
  getCurrentTaxAmount,
  getEffectiveRate,
  getEffectiveTaxAmount,
  toDecimal,
} from "./courierService.js";
import { recalculatePendingPaymentsForCourier } from "./paymentService.js";

function parseEditableRate(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWeekMode(periodStart, periodEnd) {
  return Boolean(periodStart && periodEnd);
}

async function lookupCourier(companyId, source, row, tx = prisma) {
  return tx.courier.findUnique({
    where: {
      companyId_source_externalId: {
        companyId,
        source,
        externalId: row.externalId,
      },
    },
  });
}

async function setCurrentCommission(courierId, value, tx) {
  const effectiveFrom = new Date();
  await tx.commissionHistory.updateMany({
    where: { courierId, effectiveTo: null },
    data: { effectiveTo: effectiveFrom },
  });
  return tx.commissionHistory.create({
    data: {
      courierId,
      value: toDecimal(value),
      effectiveFrom,
    },
  });
}

async function setCurrentTax(courierId, value, tx) {
  const effectiveFrom = new Date();
  await tx.taxHistory.updateMany({
    where: { courierId, effectiveTo: null },
    data: { effectiveTo: effectiveFrom },
  });
  return tx.taxHistory.create({
    data: {
      courierId,
      value: toDecimal(value),
      effectiveFrom,
    },
  });
}

async function setWeekCommission(courierId, periodStart, periodEnd, value, tx) {
  await tx.commissionHistory.deleteMany({
    where: { courierId, effectiveFrom: periodStart, effectiveTo: periodEnd },
  });
  return tx.commissionHistory.create({
    data: {
      courierId,
      value: toDecimal(value),
      effectiveFrom: periodStart,
      effectiveTo: periodEnd,
    },
  });
}

async function setWeekTax(courierId, periodStart, periodEnd, value, tx) {
  await tx.taxHistory.deleteMany({
    where: { courierId, effectiveFrom: periodStart, effectiveTo: periodEnd },
  });
  return tx.taxHistory.create({
    data: {
      courierId,
      value: toDecimal(value),
      effectiveFrom: periodStart,
      effectiveTo: periodEnd,
    },
  });
}

async function getSystemRates(courierId, periodStart, periodEnd) {
  if (isWeekMode(periodStart, periodEnd)) {
    return {
      commission: await getEffectiveRate(courierId, periodStart),
      tax: await getEffectiveTaxAmount(courierId, periodStart),
    };
  }

  return {
    commission: await getCurrentCommissionRate(courierId),
    tax: await getCurrentTaxAmount(courierId),
  };
}

export async function previewCommissionImport({
  companyId,
  source,
  rows,
  periodStart,
  periodEnd,
  applyMode = "current",
}) {
  const weekMode = applyMode === "week" && isWeekMode(periodStart, periodEnd);
  const previewRows = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const existing = await lookupCourier(companyId, source, row);
    const systemRates = existing
      ? await getSystemRates(existing.id, weekMode ? periodStart : null, weekMode ? periodEnd : null)
      : { commission: null, tax: null };

    previewRows.push({
      rowIndex: index,
      externalId: row.externalId,
      name: row.name,
      city: row.city,
      isNewCourier: !existing,
      courierId: existing?.id ?? null,
      systemCommission: systemRates.commission,
      systemTax: systemRates.tax,
      commission: row.commission ?? "",
      tax: row.tax ?? "",
    });
  }

  return {
    source,
    applyMode: weekMode ? "week" : "current",
    periodStart: weekMode ? periodStart : null,
    periodEnd: weekMode ? periodEnd : null,
    rowCount: previewRows.length,
    rows: previewRows,
  };
}

export async function confirmCommissionImport({
  companyId,
  source,
  rows,
  overrides = {},
  userId,
  periodStart,
  periodEnd,
  applyMode = "current",
}) {
  const weekMode = applyMode === "week" && isWeekMode(periodStart, periodEnd);
  const affectedCourierIds = new Set();

  const result = await runTransaction(async (tx) => {
    const results = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const override = overrides[row.externalId] ?? {};
      const commission = parseEditableRate(override.commission ?? row.commission);
      const tax = parseEditableRate(override.tax ?? row.tax);

      const existing = await lookupCourier(companyId, source, row, tx);
      const courier = await findOrCreateCourier(
        companyId,
        source,
        buildCourierRow(source, row),
        tx
      );

      const isNewCourier = !existing;
      if (isNewCourier) created += 1;

      let commissionChanged = false;
      let taxChanged = false;

      const baseline = weekMode
        ? {
            commission: isNewCourier ? 0 : await getEffectiveRate(courier.id, periodStart, tx),
            tax: isNewCourier ? 0 : await getEffectiveTaxAmount(courier.id, periodStart, tx),
          }
        : {
            commission: await getCurrentCommissionRate(courier.id, tx),
            tax: await getCurrentTaxAmount(courier.id, tx),
          };

      const targetCommission = commission ?? baseline.commission;
      const targetTax = tax ?? baseline.tax;

      if (commission !== null && commission !== baseline.commission) {
        if (weekMode) {
          await setWeekCommission(courier.id, periodStart, periodEnd, commission, tx);
        } else if (isNewCourier) {
          await tx.commissionHistory.create({
            data: {
              courierId: courier.id,
              value: toDecimal(commission),
              effectiveFrom: new Date(),
            },
          });
        } else {
          await setCurrentCommission(courier.id, commission, tx);
        }
        commissionChanged = true;
      }

      if (tax !== null && tax !== baseline.tax) {
        if (weekMode) {
          await setWeekTax(courier.id, periodStart, periodEnd, tax, tx);
        } else if (isNewCourier) {
          await tx.taxHistory.create({
            data: {
              courierId: courier.id,
              value: toDecimal(tax),
              effectiveFrom: new Date(),
            },
          });
        } else {
          await setCurrentTax(courier.id, tax, tx);
        }
        taxChanged = true;
      }

      if (!isNewCourier && !commissionChanged && !taxChanged) {
        skipped += 1;
      } else if (!isNewCourier && (commissionChanged || taxChanged)) {
        updated += 1;
      }

      if (commissionChanged || taxChanged) {
        affectedCourierIds.add(courier.id);
      }

      results.push({
        externalId: row.externalId,
        name: courier.name,
        courierId: courier.id,
        isNewCourier,
        commission: targetCommission,
        tax: targetTax,
        commissionChanged,
        taxChanged,
      });
    }

    if (userId) {
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: "create",
          entityType: "CourierImport",
          entityId: companyId,
          metadata: {
            source,
            applyMode: weekMode ? "week" : "current",
            periodStart: weekMode ? periodStart : null,
            periodEnd: weekMode ? periodEnd : null,
            rowCount: rows.length,
            created,
            updated,
            skipped,
          },
        },
      });
    }

    return {
      created,
      updated,
      skipped,
      total: rows.length,
      applyMode: weekMode ? "week" : "current",
      periodStart: weekMode ? periodStart : null,
      periodEnd: weekMode ? periodEnd : null,
      results,
    };
  });

  if (weekMode) {
    for (const courierId of affectedCourierIds) {
      await recalculatePendingPaymentsForCourier(courierId, companyId);
    }
  }

  return result;
}
