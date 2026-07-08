import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { parseExcelBuffer } from "../src/services/excelParser.js";
import { GLOVO_COLUMNS, BOLT_COLUMNS, normalizeHeader } from "../src/services/calculations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  { path: "D:\\Downloads\\W26 22..06-28.06 GLOVO WI.xlsx", source: "glovo" },
  { path: "D:\\Downloads\\W26 22.06-28.06 BOLT FOOD WI.xlsx", source: "bolt" },
];

async function inspectHeaders(filePath, source) {
  const buffer = fs.readFileSync(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];

  console.log(`\n=== ${path.basename(filePath)} ===`);
  console.log("Sheet:", sheet.name, "| Rows:", sheet.rowCount);

  const required = source === "glovo" ? GLOVO_COLUMNS.externalId : BOLT_COLUMNS.externalId;

  let found = false;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 15) return;
    const values = row.values.slice(1).map(normalizeHeader);
    const hasRequired = values.includes(required);
    if (hasRequired || rowNumber <= 5) {
      console.log(`Row ${rowNumber}${hasRequired ? " [HEADER]" : ""}:`, values.filter(Boolean).slice(0, 8).join(" | "));
    }
    if (hasRequired) found = true;
  });

  if (!found) console.log("WARNING: Required column not found:", required);
}

async function testParse(filePath, source) {
  const buffer = fs.readFileSync(filePath);
  try {
    const rows = await parseExcelBuffer(buffer, source);
    console.log(`Parsed ${rows.length} rows`);
    if (rows[0]) {
      console.log("First row keys:", Object.keys(rows[0]).join(", "));
      console.log("First row sample:", JSON.stringify(rows[0], null, 2).slice(0, 500));
    }
    return rows;
  } catch (err) {
    console.error("PARSE ERROR:", err.message);
    return null;
  }
}

async function testUpload(filePath, source) {
  const API = "http://localhost:5000/api";
  const loginRes = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@whiteintegrity.ro",
      password: "admin123",
      companySlug: "white-integrity-fleet",
    }),
  });
  const { token } = await loginRes.json();

  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("source", source);
  form.append("periodStart", "2026-06-22");
  form.append("periodEnd", "2026-06-28");
  form.append("file", new Blob([buffer]), path.basename(filePath));

  const res = await fetch(`${API}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const text = await res.text();
  console.log(`Upload status: ${res.status}`);
  if (res.ok) {
    const data = JSON.parse(text);
    console.log(`Records created: ${data.recordsCreated}`);
    if (data.records?.[0]) {
      console.log("Sample payment:", {
        name: data.records[0].courier.name,
        totalPayable: data.records[0].totalPayable,
      });
    }
  } else {
    console.log("Error:", text);
  }
}

for (const f of files) {
  await inspectHeaders(f.path, f.source);
  await testParse(f.path, f.source);
  await testUpload(f.path, f.source);
}
