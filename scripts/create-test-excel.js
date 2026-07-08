import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "test-glovo.xlsx");

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Glovo");

sheet.addRow([
  "Id curier",
  "Oras",
  "Nume",
  "Comenzi",
  "Total Venituri de transferat",
]);
sheet.addRow(["G001", "Bucharest", "Ion Popescu", 120, 1500.50]);
sheet.addRow(["G002", "Cluj", "Maria Ionescu", 95, 1200.00]);

await workbook.xlsx.writeFile(outPath);
console.log("Created:", outPath);
