import { prisma } from "../lib/prisma.js";
import { runTransaction, UPLOAD_TX_OPTIONS } from "../lib/transaction.js";
import { getExternalIdFromRow, resolveUserReceivable } from "./calculations.js";
import {
  computePeriodPayment,
  findOrCreateCourier,
  getEffectiveRate,
  getEffectiveTaxAmount,
  getPreviousDue,
  toDecimal,
} from "./courierService.js";
import { resolveUploadRates } from "./uploadPreviewService.js";

export async function recalculatePendingPaymentsForCourier(courierId, companyId, tx = prisma) {
  const courier = await tx.courier.findFirst({
    where: { id: courierId, companyId },
  });
  if (!courier) throw new Error("Courier not found");

  const pendingRecords = await tx.paymentRecord.findMany({
    where: { courierId, status: "pending" },
    include: { batch: true },
    orderBy: { batch: { periodStart: "asc" } },
  });

  // Unsettled paid-week corrections: not yet applied, or applied to a still-pending record.
  const pendingIds = pendingRecords.map((r) => r.id);
  const adjustments = await tx.paymentAdjustment.findMany({
    where: {
      courierId,
      OR: [{ appliedToRecordId: null }, { appliedToRecordId: { in: pendingIds } }],
    },
  });
  const totalAdjustment =
    Math.round(adjustments.reduce((sum, a) => sum + Number(a.amount), 0) * 100) / 100;

  let commissionRate = 0;
  let taxAmount = 0;
  let isFirst = true;

  for (const record of pendingRecords) {
    // Rate effective at the week's start — mid-week parent changes apply from the next week.
    const asOf = record.batch.periodStart;
    commissionRate = await getEffectiveRate(courierId, asOf, tx);
    taxAmount = await getEffectiveTaxAmount(courierId, asOf, tx);

    const { periodCalculated, commissionAmount, taxAmount: tax, grandPayment } = computePeriodPayment(
      courier.source,
      record.rawExcelData,
      commissionRate,
      taxAmount
    );

    const previousDue = await getPreviousDue(courierId, record.batchId, tx);
    const adjustment = isFirst ? totalAdjustment : 0;
    const totalPayable = grandPayment + previousDue.amount + adjustment;
    const userReceivableAmount = resolveUserReceivable(
      courier.source,
      record.rawExcelData,
      totalPayable
    );

    await tx.paymentRecord.update({
      where: { id: record.id },
      data: {
        periodCalculated: toDecimal(periodCalculated),
        commissionUsed: toDecimal(commissionRate),
        taxUsed: toDecimal(taxAmount),
        commissionAmount: toDecimal(commissionAmount),
        taxAmount: toDecimal(tax),
        calculatedGrandPayment: toDecimal(grandPayment),
        userReceivableAmount: toDecimal(userReceivableAmount),
        previousDueAmount: toDecimal(previousDue.amount),
        previousDueReference: previousDue.referenceId,
        adjustmentAmount: toDecimal(adjustment),
        totalPayable: toDecimal(totalPayable),
      },
    });

    if (isFirst && adjustments.length > 0) {
      await tx.paymentAdjustment.updateMany({
        where: { id: { in: adjustments.map((a) => a.id) } },
        data: { appliedToRecordId: record.id },
      });
    }
    isFirst = false;
  }

  return { updated: pendingRecords.length, commissionRate, taxAmount };
}

export async function recalculateAllPendingForCompany(companyId) {
  const couriers = await prisma.courier.findMany({
    where: {
      companyId,
      paymentRecords: { some: { status: "pending" } },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  let updated = 0;
  for (const { id } of couriers) {
    const result = await runTransaction((tx) =>
      recalculatePendingPaymentsForCourier(id, companyId, tx)
    );
    updated += result.updated;
  }
  return { couriers: couriers.length, recordsUpdated: updated };
}

const UPLOAD_BATCH_SIZE = 8;

async function processUploadRow({
  row,
  overrides,
  companyId,
  source,
  periodStart,
  periodEnd,
  batchId,
  tx,
}) {
  const externalId = getExternalIdFromRow(source, row);
  const override = overrides[externalId];

  const { courier, commissionRate, taxAmount } = await resolveUploadRates({
    companyId,
    source,
    row,
    periodStart,
    periodEnd,
    override,
    tx,
  });

  const { periodCalculated, commissionAmount, taxAmount: tax, grandPayment } = computePeriodPayment(
    source,
    row,
    commissionRate,
    taxAmount
  );

  const previousDue = await getPreviousDue(courier.id, batchId, tx, periodStart);
  const totalPayable = grandPayment + previousDue.amount;
  const userReceivableAmount = resolveUserReceivable(source, row, totalPayable);

  const record = await tx.paymentRecord.create({
    data: {
      courierId: courier.id,
      batchId,
      rawExcelData: row,
      periodCalculated: toDecimal(periodCalculated),
      commissionUsed: toDecimal(commissionRate),
      taxUsed: toDecimal(taxAmount),
      commissionAmount: toDecimal(commissionAmount),
      taxAmount: toDecimal(tax),
      calculatedGrandPayment: toDecimal(grandPayment),
      userReceivableAmount: toDecimal(userReceivableAmount),
      previousDueAmount: toDecimal(previousDue.amount),
      totalPayable: toDecimal(totalPayable),
      previousDueReference: previousDue.referenceId,
    },
  });

  return { ...record, courier };
}

export async function processExcelUpload(params) {
  const {
    companyId,
    source,
    periodStart,
    periodEnd,
    rows,
    fileReference,
    uploadedById,
    overrides = {},
  } = params;

  const batch = await prisma.paymentBatch.create({
    data: {
      companyId,
      source,
      periodStart,
      periodEnd,
      fileReference,
      uploadedById,
    },
  });

  const results = [];

  try {
    for (let index = 0; index < rows.length; index += UPLOAD_BATCH_SIZE) {
      const chunk = rows.slice(index, index + UPLOAD_BATCH_SIZE);
      const chunkRecords = await runTransaction(async (tx) => {
        const processed = [];
        for (const row of chunk) {
          processed.push(
            await processUploadRow({
              row,
              overrides,
              companyId,
              source,
              periodStart,
              periodEnd,
              batchId: batch.id,
              tx,
            })
          );
        }
        return processed;
      }, UPLOAD_TX_OPTIONS);
      results.push(...chunkRecords);
    }

    if (uploadedById) {
      await prisma.auditLog.create({
        data: {
          companyId,
          userId: uploadedById,
          action: "upload",
          entityType: "PaymentBatch",
          entityId: batch.id,
          metadata: { source, rowCount: rows.length, periodStart, periodEnd },
        },
      });
    }

    return { batch, records: results };
  } catch (err) {
    // Avoid leaving a half-imported batch if a later chunk fails.
    await prisma.paymentBatch.delete({ where: { id: batch.id } }).catch(() => {});
    throw err;
  }
}

export async function confirmPayment(params) {
  const { paymentRecordId, confirmedById, companyId, notes } = params;

  const record = await prisma.paymentRecord.findFirst({
    where: {
      id: paymentRecordId,
      courier: { companyId },
    },
    include: { courier: true },
  });

  if (!record) throw new Error("Payment record not found");
  if (record.status === "paid") throw new Error("Payment already confirmed");

  return runTransaction(async (tx) => {
    const updated = await tx.paymentRecord.update({
      where: { id: paymentRecordId },
      data: { status: "paid" },
      include: {
        courier: true,
        batch: true,
        paymentActions: { include: { confirmedBy: { select: { id: true, name: true, email: true } } } },
      },
    });

    await tx.paymentAction.create({
      data: {
        paymentRecordId,
        confirmedById,
        notes,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        userId: confirmedById,
        action: "payment_confirmed",
        entityType: "PaymentRecord",
        entityId: paymentRecordId,
        metadata: { amount: Number(record.totalPayable), courierId: record.courierId },
      },
    });

    return updated;
  });
}

/**
 * After a retroactive rate change, compute what each PAID record in the period
 * should now equal and log the difference as an adjustment. The next pending
 * payout picks these up automatically (auto-carry).
 */
async function createPaidAdjustmentsForPeriod(courier, periodStart, periodEnd, reason, tx) {
  const paidRecords = await tx.paymentRecord.findMany({
    where: {
      courierId: courier.id,
      status: "paid",
      batch: {
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
      },
    },
    include: { batch: true },
  });

  let created = 0;

  for (const record of paidRecords) {
    const asOf = record.batch.periodStart;
    const commissionRate = await getEffectiveRate(courier.id, asOf, tx);
    const taxAmount = await getEffectiveTaxAmount(courier.id, asOf, tx);

    const { grandPayment } = computePeriodPayment(
      courier.source,
      record.rawExcelData,
      commissionRate,
      taxAmount
    );

    const expectedPayable =
      grandPayment + Number(record.previousDueAmount) + Number(record.adjustmentAmount);

    const existing = await tx.paymentAdjustment.aggregate({
      where: { sourceRecordId: record.id },
      _sum: { amount: true },
    });
    const alreadyAdjusted = Number(existing._sum.amount ?? 0);

    const diff =
      Math.round((expectedPayable - Number(record.totalPayable) - alreadyAdjusted) * 100) / 100;

    if (Math.abs(diff) >= 0.01) {
      await tx.paymentAdjustment.create({
        data: {
          courierId: courier.id,
          sourceRecordId: record.id,
          amount: toDecimal(diff),
          reason,
        },
      });
      created += 1;
    }
  }

  return created;
}

export async function addCommissionRate(params) {
  const {
    courierId,
    companyId,
    value,
    effectiveFrom = new Date(),
    periodStart,
    periodEnd,
    userId,
  } = params;

  const courier = await prisma.courier.findFirst({
    where: { id: courierId, companyId },
  });
  if (!courier) throw new Error("Courier not found");

  return runTransaction(async (tx) => {
    let record;

    if (periodStart && periodEnd) {
      // Week-specific override: bounded row; current (open) rate stays for future weeks.
      await tx.commissionHistory.deleteMany({
        where: { courierId, effectiveFrom: periodStart, effectiveTo: periodEnd },
      });
      record = await tx.commissionHistory.create({
        data: {
          courierId,
          value: toDecimal(value),
          effectiveFrom: periodStart,
          effectiveTo: periodEnd,
        },
      });
    } else {
      await tx.commissionHistory.updateMany({
        where: { courierId, effectiveTo: null },
        data: { effectiveTo: effectiveFrom },
      });
      record = await tx.commissionHistory.create({
        data: {
          courierId,
          value: toDecimal(value),
          effectiveFrom,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "rate_change",
        entityType: "CommissionHistory",
        entityId: record.id,
        metadata: { courierId, value, effectiveFrom, periodStart, periodEnd },
      },
    });

    if (periodStart && periodEnd) {
      await createPaidAdjustmentsForPeriod(
        courier,
        periodStart,
        periodEnd,
        `Commission ${value}% applied retroactively`,
        tx
      );
    }

    await recalculatePendingPaymentsForCourier(courierId, companyId, tx);

    return record;
  });
}

export async function addTaxAmount(params) {
  const {
    courierId,
    companyId,
    value,
    effectiveFrom = new Date(),
    periodStart,
    periodEnd,
    userId,
  } = params;

  const courier = await prisma.courier.findFirst({
    where: { id: courierId, companyId },
  });
  if (!courier) throw new Error("Courier not found");

  return runTransaction(async (tx) => {
    let record;

    if (periodStart && periodEnd) {
      await tx.taxHistory.deleteMany({
        where: { courierId, effectiveFrom: periodStart, effectiveTo: periodEnd },
      });
      record = await tx.taxHistory.create({
        data: {
          courierId,
          value: toDecimal(value),
          effectiveFrom: periodStart,
          effectiveTo: periodEnd,
        },
      });
    } else {
      await tx.taxHistory.updateMany({
        where: { courierId, effectiveTo: null },
        data: { effectiveTo: effectiveFrom },
      });
      record = await tx.taxHistory.create({
        data: {
          courierId,
          value: toDecimal(value),
          effectiveFrom,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "rate_change",
        entityType: "TaxHistory",
        entityId: record.id,
        metadata: { courierId, value, effectiveFrom, periodStart, periodEnd },
      },
    });

    if (periodStart && periodEnd) {
      await createPaidAdjustmentsForPeriod(
        courier,
        periodStart,
        periodEnd,
        `Tax ${value} applied retroactively`,
        tx
      );
    }

    await recalculatePendingPaymentsForCourier(courierId, companyId, tx);

    return record;
  });
}

export async function deletePaymentBatch(batchId, companyId, userId) {
  const batch = await prisma.paymentBatch.findFirst({
    where: { id: batchId, companyId },
    include: {
      paymentRecords: { select: { id: true, courierId: true, status: true } },
    },
  });

  if (!batch) {
    throw new Error("Batch not found");
  }

  const recordIds = batch.paymentRecords.map((r) => r.id);
  const paidCount = batch.paymentRecords.filter((r) => r.status === "paid").length;

  if (paidCount > 0) {
    throw new Error(
      "Cannot delete batch: it contains paid payment history. Only batches with no paid records can be removed."
    );
  }

  return runTransaction(async (tx) => {
    const affectedCourierIds = new Set(batch.paymentRecords.map((r) => r.courierId));

    if (recordIds.length > 0) {
      const dependents = await tx.paymentRecord.findMany({
        where: { previousDueReference: { in: recordIds } },
        select: { courierId: true },
      });
      dependents.forEach((r) => affectedCourierIds.add(r.courierId));

      await tx.paymentRecord.updateMany({
        where: { previousDueReference: { in: recordIds } },
        data: { previousDueReference: null },
      });

      await tx.paymentAdjustment.updateMany({
        where: { appliedToRecordId: { in: recordIds } },
        data: { appliedToRecordId: null },
      });
    }

    await tx.paymentBatch.delete({ where: { id: batchId } });

    for (const courierId of affectedCourierIds) {
      await recalculatePendingPaymentsForCourier(courierId, companyId, tx);
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "delete",
        entityType: "PaymentBatch",
        entityId: batchId,
        metadata: {
          source: batch.source,
          periodStart: batch.periodStart,
          periodEnd: batch.periodEnd,
          recordsRemoved: recordIds.length,
          paidRecordsRemoved: paidCount,
          fileReference: batch.fileReference,
        },
      },
    });

    return {
      deleted: true,
      recordsRemoved: recordIds.length,
      paidRecordsRemoved: paidCount,
    };
  });
}
