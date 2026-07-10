import ExcelJS from "exceljs";
import { normalizeHeader, extractPlainValue } from "./calculations.js";

function sanitizeCellValue(value) {
  const plain = extractPlainValue(value);
  if (plain === null || plain === "") return null;
  if (typeof plain === "number" || typeof plain === "boolean") return plain;
  return plain;
}

function rowToObject(headers, values) {
  const obj = {};
  headers.forEach((header, i) => {
    if (header) obj[header] = sanitizeCellValue(values[i]);
  });
  return obj;
}

function pickValue(obj, aliases) {
  for (const key of aliases) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }
  return null;
}

function parseRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const COLUMN_ALIASES = {
  glovo: {
    externalId: ["Id curier", "ID Curier", "Id Curier"],
    name: ["Name", "Nume"],
    tax: ["TAX", "Tax"],
    commission: ["COMISSION", "COMMISSION", "Commission", "Comision"],
  },
  bolt: {
    externalId: ["Courier UID", "Courier uid"],
    firstName: ["First Name", "First name"],
    lastName: ["Last Name", "Last name"],
    tax: ["TAX", "Tax"],
    commission: ["COMISSION", "COMMISSION", "Commission", "Comision"],
  },
};

function normalizeRow(source, obj) {
  const aliases = COLUMN_ALIASES[source];
  const externalId = String(pickValue(obj, aliases.externalId) ?? "").trim();
  if (!externalId) return null;

  const tax = parseRate(pickValue(obj, aliases.tax));
  const commission = parseRate(pickValue(obj, aliases.commission));

  if (source === "glovo") {
    return {
      externalId,
      name: String(pickValue(obj, aliases.name) ?? "Unknown").trim() || "Unknown",
      city: null,
      tax,
      commission,
    };
  }

  const firstName = String(pickValue(obj, aliases.firstName) ?? "").trim();
  const lastName = String(pickValue(obj, aliases.lastName) ?? "").trim();
  const name = `${firstName} ${lastName}`.trim() || "Unknown";

  return {
    externalId,
    name,
    city: null,
    tax,
    commission,
  };
}

function buildCourierRow(source, row) {
  if (source === "glovo") {
    return {
      "Id curier": row.externalId,
      Nume: row.name,
      Oras: row.city,
    };
  }

  const [firstName, ...rest] = row.name.split(" ");
  return {
    "Courier UID": row.externalId,
    "First Name": firstName || row.name,
    "Last Name": rest.join(" ") || "",
  };
}

export async function parseCommissionListBuffer(buffer, source) {
  if (!buffer?.length) {
    throw new Error("Uploaded file is empty");
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error("Could not read Excel file. Please upload a valid .xlsx file.");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Excel file has no worksheets");

  const requiredAliases = COLUMN_ALIASES[source].externalId;
  let headerRowIndex = -1;
  let headers = [];

  sheet.eachRow((row, rowNumber) => {
    if (headerRowIndex >= 0) return;
    const values = row.values.slice(1);
    const normalized = values.map(normalizeHeader);
    if (requiredAliases.some((alias) => normalized.includes(normalizeHeader(alias)))) {
      headerRowIndex = rowNumber;
      headers = normalized;
    }
  });

  if (headerRowIndex < 0) {
    throw new Error(
      `Missing courier ID column. Expected one of: ${requiredAliases.join(", ")}`
    );
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;
    const values = row.values.slice(1);
    const obj = rowToObject(headers, values);
    const parsed = normalizeRow(source, obj);
    if (parsed) rows.push(parsed);
  });

  return rows;
}

export { buildCourierRow };
