import { resolveDateRange } from "./reportService.js";
import { resolveDisplayRate } from "./courierService.js";

export function buildCourierListQuery(params) {
  const { companyId, source, search, page, limit, period, month, year, weekEnd } = params;

  const where = {
    companyId,
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { externalId: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  let range = null;
  let periodPaymentFilter = null;

  if (period) {
    range = resolveDateRange({ period, month, year, weekEnd });
    where.paymentRecords = {
      some: {
        batch: {
          periodStart: { lte: range.end },
          periodEnd: { gte: range.start },
        },
      },
    };
    periodPaymentFilter = {
      batch: {
        periodStart: { lte: range.end },
        periodEnd: { gte: range.start },
      },
    };
  }

  return { where, range, periodPaymentFilter, page, limit };
}

export function summarizeCourierRow(courier, hasPeriodFilter) {
  const records = courier.paymentRecords || [];
  const currentCommission = resolveDisplayRate(courier.commissionHistory);
  const currentTax = resolveDisplayRate(courier.taxHistory);

  if (hasPeriodFilter) {
    const periodPayable = records.reduce((sum, r) => sum + Number(r.totalPayable), 0);
    const periodTax = records.reduce((sum, r) => sum + Number(r.taxAmount ?? 0), 0);

    return {
      ...courier,
      currentCommission,
      currentTax,
      pendingDue: 0,
      periodPayable,
      periodTax,
      commissionHistory: undefined,
      taxHistory: undefined,
      paymentRecords: undefined,
    };
  }

  return {
    ...courier,
    currentCommission,
    currentTax,
    pendingDue: records[0] ? Number(records[0].totalPayable) : 0,
    periodPayable: null,
    periodTax: null,
    commissionHistory: undefined,
    taxHistory: undefined,
    paymentRecords: undefined,
  };
}
