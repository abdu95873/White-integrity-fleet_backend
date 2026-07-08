import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseExcelBuffer } from "../src/services/excelParser.js";
import { processExcelUpload } from "../src/services/paymentService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testFile(name, setupFn) {
  const outPath = path.join(__dirname, name);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  setupFn(sheet);
  await workbook.xlsx.writeFile(outPath);

  const buffer = fs.readFileSync(outPath);
  try {
    const rows = await parseExcelBuffer(buffer, "glovo");
    console.log(`\n${name}: parsed ${rows.length} rows`);
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));

    // Test JSON serialization (what Prisma needs)
    JSON.stringify(rows[0]);
    console.log("JSON.stringify: OK");

    const result = await processExcelUpload({
      companyId: "cmr7rqirf0000uu4kebfslvg2",
      source: "glovo",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-01-07"),
      rows,
      fileReference: name,
      uploadedById: "cmr7rqiu30002uu4kemi6z58b",
    });
    console.log("DB insert: OK, records:", result.records.length);
  } catch (err) {
    console.error(`${name}: FAILED -`, err.message);
    console.error(err.stack);
  }
}

await testFile("test-dates.xlsx", (sheet) => {
  sheet.addRow(["Id curier", "Oras", "Nume", "Total Venituri de transferat"]);
  sheet.addRow(["G003", "Bucharest", "Test User", 999.99]);
  sheet.getCell("D2").value = new Date("2026-01-15");
});

await testFile("test-formula.xlsx", (sheet) => {
  sheet.addRow(["Id curier", "Oras", "Nume", "Total Venituri de transferat"]);
  sheet.addRow(["G004", "Bucharest", "Formula User", { formula: "100+200", result: 300 }]);
});

await testFile("test-richtext.xlsx", (sheet) => {
  sheet.addRow(["Id curier", "Oras", "Nume", "Total Venituri de transferat"]);
  sheet.addRow(["G005", "Bucharest", { richText: [{ text: "Rich " }, { text: "Text" }] }, 500]);
});

process.exit(0);
