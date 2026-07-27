import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { toDateOnlyString, utcDateOnly } from "../lib/dateOnly.js";
import { resolveUserReceivable } from "./calculations.js";
import { formatPaymentRecord } from "./paymentFormat.js";

function formatRangeLabel(start, end) {
  const fmt = (d) => {
    const s = toDateOnlyString(d);
    const [y, m, day] = s.split("-");
    return `${day}/${m}/${y}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatFileDate(value) {
  return toDateOnlyString(value);
}

function formatExportDate(value) {
  if (!value) return "";
  const s = toDateOnlyString(value);
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

/** Prisma filter for batch period. Weekly = exact week; monthly/yearly = overlap. */
export function batchPeriodFilter(period, start, end) {
  if (period === "weekly") {
    // Exact match so Glovo (Mon–Sun) and Bolt (Sun–Sat) weeks do not mix.
    return {
      periodStart: start,
      periodEnd: utcDateOnly(end),
    };
  }

  return {
    periodStart: { lte: end },
    periodEnd: { gte: start },
  };
}

export function resolveDateRange({ period, month, year, weekStart, weekEnd }) {
  const now = new Date();

  if (period === "monthly") {
    const y = year ?? now.getUTCFullYear();
    const m = month ?? now.getUTCMonth() + 1;
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    const label = `${y}-${String(m).padStart(2, "0")}`;
    return { start, end, label, fileLabel: label };
  }

  if (period === "yearly") {
    const y = year ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
    const label = String(y);
    return { start, end, label, fileLabel: label };
  }

  // weekly — UTC date-only bounds matching uploaded batch periods
  const endDay = utcDateOnly(weekEnd);
  const start = weekStart
    ? utcDateOnly(weekStart)
    : new Date(Date.UTC(endDay.getUTCFullYear(), endDay.getUTCMonth(), endDay.getUTCDate() - 6));
  const end = new Date(endDay);
  end.setUTCHours(23, 59, 59, 999);
  const label = formatRangeLabel(start, endDay);
  return {
    start,
    end,
    label,
    fileLabel: `${formatFileDate(start)}_to_${formatFileDate(endDay)}`,
  };
}

function resolveRecordReceivable(record, formatted) {
  const stored = Number(formatted.userReceivableAmount ?? 0);
  if (stored > 0) return stored;

  return resolveUserReceivable(
    record.courier.source,
    record.rawExcelData,
    formatted.totalPayable
  );
}

export async function fetchReportData(params) {
  const { companyId, period, month, year, weekStart, weekEnd, source, courierId } = params;
  const { start, end } = resolveDateRange({ period, month, year, weekStart, weekEnd });

  const courierFilter = {
    companyId,
    ...(source ? { source } : {}),
  };

  const where = {
    courier: courierFilter,
    batch: batchPeriodFilter(period, start, end),
    ...(courierId ? { courierId } : {}),
  };

  const records = await prisma.paymentRecord.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      courier: true,
      batch: true,
      paymentActions: {
        include: { confirmedBy: { select: { name: true, email: true } } },
      },
    },
  });

  return {
    // Date-only strings avoid timezone shifting the "Showing:" label in the UI
    range: { start: toDateOnlyString(start), end: toDateOnlyString(utcDateOnly(end)) },
    rows: records.map((r) => {
      const formatted = formatPaymentRecord(r);
      return {
        courierId: r.courier.externalId,
        courierName: r.courier.name,
        source: r.courier.source,
        periodStart: r.batch.periodStart,
        periodEnd: r.batch.periodEnd,
        periodCalculated: formatted.periodCalculated,
        commissionUsed: formatted.commissionUsed,
        commissionAmount: formatted.commissionAmount,
        taxUsed: formatted.taxUsed,
        taxAmount: formatted.taxAmount,
        calculatedGrandPayment: formatted.calculatedGrandPayment,
        previousDueAmount: formatted.previousDueAmount,
        userReceivableAmount: resolveRecordReceivable(r, formatted),
        totalPayable: formatted.totalPayable,
        status: r.status,
        confirmedAt: r.paymentActions[0]?.confirmedAt ?? null,
        confirmedBy: r.paymentActions[0]?.confirmedBy?.name ?? null,
      };
    }),
  };
}

export async function fetchCourierPaymentHistoryRows(courierId, companyId) {
  const courier = await prisma.courier.findFirst({
    where: { id: courierId, companyId },
    select: { id: true, name: true, externalId: true, source: true },
  });

  if (!courier) {
    throw new Error("Courier not found");
  }

  const records = await prisma.paymentRecord.findMany({
    where: { courierId },
    orderBy: { createdAt: "desc" },
    include: {
      batch: true,
      paymentActions: {
        orderBy: { confirmedAt: "desc" },
        take: 1,
        include: { confirmedBy: { select: { name: true } } },
      },
    },
  });

  const rows = records.map((r) => {
    const formatted = formatPaymentRecord(r);
    const paymentAction = r.paymentActions[0];

    return {
      "Courier ID": courier.externalId,
      "Courier Name": courier.name,
      Platform: courier.source,
      "Period Start": formatExportDate(r.batch.periodStart),
      "Period End": formatExportDate(r.batch.periodEnd),
      Calculated: formatted.periodCalculated,
      "Commission %": formatted.commissionUsed,
      "Commission Amount": formatted.commissionAmount,
      "Tax Amount": formatted.taxAmount,
      "Due from User": formatted.userReceivableAmount,
      "Grand Payment": formatted.calculatedGrandPayment,
      "Previous Due": formatted.previousDueAmount,
      Adjustment: formatted.adjustmentAmount,
      "Total Payable": formatted.totalPayable,
      Status: r.status,
      "Paid At": paymentAction?.confirmedAt ? formatExportDate(paymentAction.confirmedAt) : "",
      "Confirmed By": paymentAction?.confirmedBy?.name ?? "",
    };
  });

  return { courier, rows };
}

export function toCsv(rows) {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = val === null || val === undefined ? "" : String(val);
          return str.includes(",") ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(",")
    ),
  ];
  return lines.join("\n");
}

export async function toExcel(rows, sheetName = "Report") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  if (rows.length === 0) {
    sheet.addRow(["No data"]);
  } else {
    const headers = Object.keys(rows[0]);
    sheet.addRow(headers);
    rows.forEach((row) => {
      sheet.addRow(headers.map((h) => row[h]));
    });
    sheet.getRow(1).font = { bold: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function getDashboardStats(companyId) {
  const [courierCount, pendingPayments, paidThisMonth, recentBatches] = await Promise.all([
    prisma.courier.count({ where: { companyId } }),
    prisma.paymentRecord.aggregate({
      where: { courier: { companyId }, status: "pending" },
      _sum: { totalPayable: true },
      _count: true,
    }),
    prisma.paymentRecord.aggregate({
      where: {
        courier: { companyId },
        status: "paid",
        paymentActions: {
          some: {
            confirmedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
        },
      },
      _sum: { totalPayable: true },
    }),
    prisma.paymentBatch.findMany({
      where: { companyId },
      orderBy: { uploadedAt: "desc" },
      take: 5,
      include: { _count: { select: { paymentRecords: true } } },
    }),
  ]);

  return {
    courierCount,
    pendingCount: pendingPayments._count,
    pendingTotal: Number(pendingPayments._sum.totalPayable ?? 0),
    paidThisMonth: Number(paidThisMonth._sum.totalPayable ?? 0),
    recentBatches,
  };
}
