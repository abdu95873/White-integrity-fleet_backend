import PDFDocument from "pdfkit";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_UPPER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function formatChartDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS_SHORT[d.getMonth()]}-${d.getFullYear()}`;
}

function formatWeekRange(start, end) {
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  return `${s.getDate()}-${MONTHS_UPPER[s.getMonth()]}-${e.getDate()}-${MONTHS_UPPER[e.getMonth()]}-${e.getFullYear()}`;
}

function formatAmount(value) {
  const num = Number(value) || 0;
  if (Number.isInteger(num) || Math.abs(num - Math.round(num)) < 0.001) {
    return String(Math.round(num));
  }
  return num.toFixed(2);
}

const PDF_CELL_PAD = 6;
const PDF_ROW_HEIGHT = 26;
const PDF_HEADER_HEIGHT = 28;
const PDF_BORDER_COLOR = "#000000";
const PDF_FONT_SIZE = 9;

function fitColumns(columns, pageWidth) {
  const fitted = columns.map((col) => ({ ...col }));
  const sum = fitted.reduce((total, col) => total + col.width, 0);
  fitted[fitted.length - 1].width += pageWidth - sum;
  return fitted;
}

function drawRowGrid(doc, columns, left, y, rowHeight) {
  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);

  doc.save();
  doc.lineWidth(0.5).strokeColor(PDF_BORDER_COLOR);

  doc.moveTo(left, y).lineTo(left + tableWidth, y).stroke();
  doc.moveTo(left, y + rowHeight).lineTo(left + tableWidth, y + rowHeight).stroke();

  let x = left;
  for (let i = 0; i <= columns.length; i += 1) {
    doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
    if (i < columns.length) x += columns[i].width;
  }

  doc.restore();
}

function drawPdfCellText(doc, text, x, y, col, rowHeight) {
  const innerWidth = Math.max(col.width - PDF_CELL_PAD * 2, 1);
  const textY = y + Math.max((rowHeight - PDF_FONT_SIZE) / 2, 3);
  doc.text(String(text ?? ""), x + PDF_CELL_PAD, textY, {
    width: innerWidth,
    align: col.align || "left",
    lineBreak: false,
    ellipsis: true,
  });
}

function drawTableRow(doc, columns, left, y, rowHeight, getValue, getCol = (col) => col) {
  drawRowGrid(doc, columns, left, y, rowHeight);

  let x = left;
  for (const col of columns) {
    const cellCol = getCol(col);
    const value = getValue(col);
    if (value !== null && value !== undefined && value !== "") {
      drawPdfCellText(doc, value, x, y, cellCol, rowHeight);
    }
    x += col.width;
  }

  return y + rowHeight;
}

function buildPdfColumns(pageWidth, isBolt) {
  if (isBolt) {
    return fitColumns(
      [
        { key: "rowNumber", title: "Row Number", width: 42, align: "center" },
        { key: "externalId", title: "Courier UID", width: 62, align: "left" },
        { key: "firstName", title: "First Name", width: 78, align: "left" },
        { key: "lastName", title: "Last Name", width: 250, align: "left" },
        { key: "paymentLabel", title: "Payment", width: 68, align: "right" },
        { key: "dueTotal", title: "Due", width: 55, align: "right" },
        { key: "signature", title: "PAYMENT BY SIGNATURE", width: 175, align: "center" },
      ],
      pageWidth
    );
  }

  return fitColumns(
    [
      { key: "rowNumber", title: "Row Number", width: 52, align: "center" },
      { key: "externalId", title: "Courier UID", width: 100, align: "left" },
      { key: "name", title: "Last Name", width: 280, align: "left" },
      { key: "paymentLabel", title: "Payment", width: 68, align: "right" },
      { key: "dueTotal", title: "Due", width: 55, align: "right" },
      { key: "signature", title: "PAYMENT BY SIGNATURE", width: 175, align: "center" },
    ],
    pageWidth
  );
}

function splitBoltName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function platformLabel(source) {
  return source === "glovo" ? "GLOVO" : "BOLT";
}

function dueSectionTitle(source) {
  return source === "glovo" ? "NET PAYMENT CASH DUE" : "NET PAYMENT CASH OVER DUE";
}

function prepareRows(rows) {
  return [...rows]
    .sort((a, b) => String(a.courierName).localeCompare(String(b.courierName)))
    .map((row, index) => {
      const payment = Number(row.totalPayable) || 0;
      const due = Number(row.userReceivableAmount) || 0;
      const boltNames = splitBoltName(row.courierName);

      return {
        rowNumber: index + 1,
        externalId: row.courierId,
        name: row.courierName,
        firstName: boltNames.firstName,
        lastName: boltNames.lastName,
        payment,
        paymentLabel: formatAmount(payment),
        due,
        dueLabel: due > 0 ? formatAmount(due) : "",
      };
    });
}

function headerCellValue(col) {
  return col.title;
}

function totalCellValue(col, netPayment, cashDue, isBolt) {
  if (isBolt && col.key === "lastName") return "TOTAL";
  if (!isBolt && col.key === "name") return "TOTAL";
  if (col.key === "paymentLabel") return formatAmount(netPayment);
  if (col.key === "dueTotal") return formatAmount(cashDue);
  return "";
}

function dataCellValue(col, row, isBolt) {
  if (col.key === "signature") return "";
  if (col.key === "paymentLabel") {
    if (row.due > 0) return "DUE";
    return row.paymentLabel;
  }
  if (col.key === "dueTotal") {
    return row.due > 0 ? row.dueLabel : "";
  }
  return row[col.key] ?? "";
}

function formatDueLine(row, isBolt) {
  if (isBolt) {
    return `${row.externalId}  ${row.firstName}  ${row.lastName}`.trim();
  }
  return `${row.externalId} ${row.name}`.trim();
}

export function buildPaymentChartPdf({
  source,
  companyName,
  range,
  rows,
  reportDate = new Date(),
}) {
  const prepared = prepareRows(rows);
  const netPayment = prepared.reduce((sum, row) => sum + row.payment, 0);
  const cashDue = prepared.reduce((sum, row) => sum + row.due, 0);
  const dueRows = prepared.filter((row) => row.due > 0);
  const isBolt = source === "bolt";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
      bufferPages: true,
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    let y = doc.page.margins.top;
    let columns = buildPdfColumns(pageWidth, isBolt);

    const drawTitle = () => {
      const brand = String(companyName || "WHITE FLEET").toUpperCase();
      doc.font("Helvetica-Bold").fontSize(16).text(`${brand} ${platformLabel(source)} PAYMENT CHART`, left, y, {
        width: pageWidth,
        align: "center",
      });
      y += 24;

      doc.font("Helvetica").fontSize(10);
      doc.text(
        `Week   ${formatWeekRange(range.start, range.end)}    DATE:   ${formatChartDate(reportDate)}`,
        left,
        y,
        { width: pageWidth, align: "center" }
      );
      y += 22;
    };

    const drawHeader = () => {
      columns = buildPdfColumns(pageWidth, isBolt);
      doc.font("Helvetica-Bold").fontSize(PDF_FONT_SIZE);
      y = drawTableRow(doc, columns, left, y, PDF_HEADER_HEIGHT, (col) => headerCellValue(col));
    };

    const drawTotalRow = () => {
      ensureSpace(PDF_ROW_HEIGHT);
      doc.font("Helvetica-Bold").fontSize(PDF_FONT_SIZE);
      y = drawTableRow(
        doc,
        columns,
        left,
        y,
        PDF_ROW_HEIGHT,
        (col) => totalCellValue(col, netPayment, cashDue, isBolt),
        (col) => {
          if (col.key === "paymentLabel" || col.key === "dueTotal") {
            return { ...col, align: "right" };
          }
          if (col.key === "lastName" || col.key === "name") {
            return { ...col, align: "right" };
          }
          return col;
        }
      );
    };

    const ensureSpace = (height, { withHeader = true } = {}) => {
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (y + height > bottom) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
        y = doc.page.margins.top;
        drawTitle();
        if (withHeader) {
          drawHeader();
        }
      }
    };

    const drawRow = (row) => {
      ensureSpace(PDF_ROW_HEIGHT);
      doc.font("Helvetica").fontSize(PDF_FONT_SIZE);
      y = drawTableRow(doc, columns, left, y, PDF_ROW_HEIGHT, (col) => dataCellValue(col, row, isBolt));
    };

    drawTitle();
    drawHeader();

    for (const row of prepared) {
      drawRow(row);
    }

    drawTotalRow();

    // Due section is plain text — never redraw table headers on page breaks.
    ensureSpace(40, { withHeader: false });
    y += 12;
    doc.font("Helvetica-Bold").fontSize(10).text(dueSectionTitle(source), left, y, {
      width: pageWidth,
      lineBreak: false,
    });
    y += 18;

    doc.font("Helvetica").fontSize(9);
    if (dueRows.length > 0) {
      for (const row of dueRows) {
        ensureSpace(16, { withHeader: false });
        doc.text(formatDueLine(row, isBolt), left, y, { width: pageWidth, lineBreak: false });
        y += 16;
      }
    }

    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i += 1) {
      doc.switchToPage(i);
      const footerY = doc.page.height - doc.page.margins.bottom + 4;
      doc.font("Helvetica").fontSize(8).fillColor("#666666");
      doc.text(`${i - pages.start + 1} of ${pages.count}`, left, footerY, {
        width: pageWidth,
        align: "center",
        height: 10,
        lineBreak: false,
      });
      doc.fillColor("#000000");
    }

    doc.end();
  });
}

export async function buildPaymentChartExcel({ source, companyName, range, rows, reportDate = new Date() }) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Payment Chart");
  const prepared = prepareRows(rows);
  const netPayment = prepared.reduce((sum, row) => sum + row.payment, 0);
  const cashDue = prepared.reduce((sum, row) => sum + row.due, 0);
  const isBolt = source === "bolt";
  const brand = String(companyName || "WHITE FLEET").toUpperCase();
  const lastCol = isBolt ? "G" : "F";

  sheet.mergeCells(`A1:${lastCol}1`);
  sheet.getCell("A1").value = `${brand} ${platformLabel(source)} PAYMENT CHART`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: "center" };

  sheet.mergeCells(`A2:${lastCol}2`);
  sheet.getCell("A2").value = `Week ${formatWeekRange(range.start, range.end)}    DATE: ${formatChartDate(reportDate)}`;
  sheet.getCell("A2").alignment = { horizontal: "center" };

  const header = isBolt
    ? ["Row Number", "Courier UID", "First Name", "Last Name", "Payment", "Due", "PAYMENT BY SIGNATURE"]
    : ["Row Number", "Courier UID", "Last Name", "Payment", "Due", "PAYMENT BY SIGNATURE"];

  sheet.addRow(header);
  const headerRow = sheet.lastRow;
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.getCell(1).alignment = { horizontal: "center" };
  headerRow.getCell(isBolt ? 5 : 4).alignment = { horizontal: "right" };
  headerRow.getCell(isBolt ? 6 : 5).alignment = { horizontal: "right" };
  headerRow.getCell(isBolt ? 7 : 6).alignment = { horizontal: "center" };

  for (const row of prepared) {
    if (isBolt) {
      sheet.addRow([
        row.rowNumber,
        row.externalId,
        row.firstName,
        row.lastName,
        row.due > 0 ? "DUE" : row.payment,
        row.due > 0 ? row.due : "",
        "",
      ]);
    } else {
      sheet.addRow([
        row.rowNumber,
        row.externalId,
        row.name,
        row.due > 0 ? "DUE" : row.payment,
        row.due > 0 ? row.due : "",
        "",
      ]);
    }
  }

  const totalsRow = isBolt
    ? sheet.addRow(["", "", "", "TOTAL", netPayment, cashDue, ""])
    : sheet.addRow(["", "", "TOTAL", netPayment, cashDue, ""]);
  totalsRow.font = { bold: true };
  totalsRow.getCell(isBolt ? 4 : 3).alignment = { horizontal: "right" };
  totalsRow.getCell(isBolt ? 5 : 4).alignment = { horizontal: "right" };
  totalsRow.getCell(isBolt ? 6 : 5).alignment = { horizontal: "right" };

  sheet.addRow([]);
  sheet.addRow([dueSectionTitle(source)]);
  sheet.lastRow.font = { bold: true };

  for (const row of prepared.filter((item) => item.due > 0)) {
    if (isBolt) {
      sheet.addRow([row.externalId, row.firstName, row.lastName]);
    } else {
      sheet.addRow([row.externalId, row.name]);
    }
  }

  sheet.columns = isBolt
    ? [
        { width: 10 },
        { width: 14 },
        { width: 16 },
        { width: 30 },
        { width: 12 },
        { width: 10 },
        { width: 22 },
      ]
    : [
        { width: 10 },
        { width: 14 },
        { width: 32 },
        { width: 12 },
        { width: 10 },
        { width: 22 },
      ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
