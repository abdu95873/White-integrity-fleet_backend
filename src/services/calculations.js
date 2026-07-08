export const GLOVO_COLUMNS = {
  externalId: "Id curier",
  city: "Oras",
  name: "Nume",
  orders: "Comenzi",
  orderBonus: "Bonus Numar de Comenzi",
  revenue: "Venituri",
  dailyCash: "Plata zilnica cu cash",
  tips: "Tips",
  accountFee: "Taxa deschidere cont",
  appFee: "Taxa aplicatie",
  totalAdjustments: "Ajustari Totale",
  totalTransfer: "Total Venituri de transferat",
};

export const BOLT_COLUMNS = {
  externalId: "Courier UID",
  firstName: "First Name",
  lastName: "Last Name",
  adjustments: "Courier Adjustments",
  adjustedEarnings: "Adjusted Earnings (Without VAT)",
  tips: "Courier Tips (With VAT)",
  overdueDebt: "Overdue courier cash debt",
  balanceAfterPeriod: "Balance After Period",
};

export function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function extractPlainValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.trim();

  if (typeof value === "object") {
    if (value.result !== undefined && value.result !== null) {
      return extractPlainValue(value.result);
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
    if (typeof value.text === "string") return value.text.trim();
    if (value.hyperlink) return String(value.text ?? value.hyperlink).trim();
  }

  return String(value).trim();
}

export function parseNumber(value) {
  const plain = extractPlainValue(value);
  if (plain === null || plain === "") return 0;
  if (typeof plain === "number") return plain;

  const str = String(plain);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return 0;

  const cleaned = str.replace(/[^\d.,-]/g, "").replace(",", ".");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function paymentBreakdown(periodCalculated, commissionRate, taxAmount) {
  const commissionAmount = periodCalculated * (commissionRate / 100);
  const tax = Math.max(0, Number(taxAmount) || 0);
  return {
    commissionAmount: Math.round(commissionAmount * 100) / 100,
    taxAmount: Math.round(tax * 100) / 100,
    afterCommission: Math.round((periodCalculated - commissionAmount) * 100) / 100,
  };
}

export function calculateGlovoPayment(row, commissionRate, taxAmount) {
  const totalTransfer = parseNumber(row[GLOVO_COLUMNS.totalTransfer]);
  const { commissionAmount, taxAmount: tax } = paymentBreakdown(totalTransfer, commissionRate, taxAmount);
  const grandPayment = totalTransfer - commissionAmount - tax;
  return { periodCalculated: totalTransfer, commissionAmount, taxAmount: tax, grandPayment };
}

export function calculateBoltPayment(row, commissionRate, taxAmount) {
  const earnings = parseNumber(row[BOLT_COLUMNS.adjustedEarnings]);
  const tips = parseNumber(row[BOLT_COLUMNS.tips]);
  const overdueDebt = parseNumber(row[BOLT_COLUMNS.overdueDebt]);
  const subtotal = earnings + tips;
  const { commissionAmount, taxAmount: tax } = paymentBreakdown(subtotal, commissionRate, taxAmount);
  const afterTax = subtotal - commissionAmount - tax;
  const grandPayment = afterTax - overdueDebt;
  return { periodCalculated: subtotal, commissionAmount, taxAmount: tax, grandPayment };
}

export function getUserReceivableFromRow(source, row) {
  if (source === "glovo") {
    const dailyCash = parseNumber(row[GLOVO_COLUMNS.dailyCash]);
    if (dailyCash < 0) return Math.abs(dailyCash);

    const totalAdjustments = parseNumber(row[GLOVO_COLUMNS.totalAdjustments]);
    if (totalAdjustments < 0) return Math.abs(totalAdjustments);
  }

  return 0;
}

/** Net amount the user/courier owes the operator after period settlement. */
export function resolveUserReceivable(source, row, totalPayable) {
  const payable = Number(totalPayable);

  // Negative payable = courier owes operator (debt exceeds this period's net payout)
  if (payable < 0) {
    return Math.round(Math.abs(payable) * 100) / 100;
  }

  // Glovo-only: cash/adjustment fields not always reflected in payable
  return getUserReceivableFromRow(source, row);
}

export function getCourierNameFromRow(source, row) {
  if (source === "glovo") {
    return extractPlainValue(row[GLOVO_COLUMNS.name]) || "Unknown";
  }
  const first = extractPlainValue(row[BOLT_COLUMNS.firstName]) || "";
  const last = extractPlainValue(row[BOLT_COLUMNS.lastName]) || "";
  return `${first} ${last}`.trim() || "Unknown";
}

export function getExternalIdFromRow(source, row) {
  const key = source === "glovo" ? GLOVO_COLUMNS.externalId : BOLT_COLUMNS.externalId;
  const val = extractPlainValue(row[key]);
  return val !== null && val !== undefined ? String(val).trim() : "";
}

export function getCityFromRow(source, row) {
  if (source === "glovo") {
    return extractPlainValue(row[GLOVO_COLUMNS.city]);
  }
  return null;
}
