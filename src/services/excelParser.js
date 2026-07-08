import ExcelJS from "exceljs";
import { BOLT_COLUMNS, GLOVO_COLUMNS, extractPlainValue, normalizeHeader } from "./calculations.js";

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

export async function parseExcelBuffer(buffer, source) {
  if (!buffer?.length) {
    throw new Error("Uploaded file is empty");
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error("Could not read Excel file. Please upload a valid .xlsx file (not .xls).");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Excel file has no worksheets");

  const requiredColumn =
    source === "glovo" ? GLOVO_COLUMNS.externalId : BOLT_COLUMNS.externalId;

  let headerRowIndex = -1;
  let headers = [];

  sheet.eachRow((row, rowNumber) => {
    if (headerRowIndex >= 0) return;
    const values = row.values.slice(1);
    const normalized = values.map(normalizeHeader);
    if (normalized.includes(requiredColumn)) {
      headerRowIndex = rowNumber;
      headers = normalized;
    }
  });

  if (headerRowIndex < 0) {
    throw new Error(`Missing required column: "${requiredColumn}". Check that you selected the correct platform (Glovo/Bolt).`);
  }

  const rows = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;
    const values = row.values.slice(1);
    const obj = rowToObject(headers, values);
    const externalId = String(extractPlainValue(obj[requiredColumn]) ?? "").trim();
    if (!externalId) return;
    rows.push(obj);
  });

  return rows;
}
