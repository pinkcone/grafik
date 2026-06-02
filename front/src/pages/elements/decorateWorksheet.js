import * as XLSX from "xlsx-js-style";

/**
 * Dekoruje arkusz Excela:
 * - wrapText
 * - nagłówki
 * - weekendy
 * - autoszerokość
 * - wysokość wierszy
 * - freeze
 * - obramowania
 */

/* === OBRAMOWANIA === */
const baseBorder = {
  top:    { style: "thin", color: { rgb: "000000" } },
  bottom: { style: "thin", color: { rgb: "000000" } },
  left:   { style: "thin", color: { rgb: "000000" } },
  right:  { style: "thin", color: { rgb: "000000" } },
};

const headerBorder = {
  top:    { style: "medium", color: { rgb: "000000" } },
  bottom: { style: "medium", color: { rgb: "000000" } },
  left:   { style: "medium", color: { rgb: "000000" } },
  right:  { style: "medium", color: { rgb: "000000" } },
};

export const decorateWorksheet = ({
  ws,
  data,
  days,
  year,
  month,
  freezeHeader = true,
  markWeekends = true
}) => {
  if (!ws || !data) return;

  /* === WRAP TEXT + TOP ALIGN + BASE BORDER === */
  Object.keys(ws).forEach(cell => {
    if (!cell.startsWith("!")) {
      ws[cell].s = {
        ...(ws[cell].s || {}),
        alignment: { wrapText: true, vertical: "top" },
        border: baseBorder
      };
    }
  });

  /* === HEADER STYLE (BOLD + CENTER + THICK BORDER) === */
  Object.keys(ws).forEach(cell => {
    if (cell.startsWith("!")) return;

    const { r } = XLSX.utils.decode_cell(cell);
    if (r === 0) {
      ws[cell].s = {
        ...(ws[cell].s || {}),
        font: { bold: true },
        alignment: { horizontal: "center", vertical: "center" },
        border: headerBorder
      };
    }
  });

  /* === FREEZE HEADER === */
  if (freezeHeader) {
    ws["!freeze"] = { xSplit: 1, ySplit: 1 };
  }

  /* === AUTOSIZE COLUMNS === */
  ws["!cols"] = data[0].map((_, colIdx) => {
    const maxLen = Math.max(
      ...data.map(row =>
        row[colIdx] ? row[colIdx].toString().length : 0
      )
    );
    return { wch: Math.min(Math.max(maxLen + 1, 7), 45) };
  });

  ws["!rows"] = data.map(row => {
    const lines = row.join("").split("\n").length;
    return { hpt: Math.max(18, lines * 18) };
  });

if (markWeekends && days?.length) {
  days.forEach((day, idx) => {
    const d = new Date(year, month - 1, day);
    const dayOfWeek = d.getDay();

    const isSaturday = dayOfWeek === 6;
    const isSunday = dayOfWeek === 0;

    if (!isSaturday && !isSunday) return;

    Object.keys(ws).forEach(cell => {
      if (cell.startsWith("!")) return;

      const c = XLSX.utils.decode_cell(cell);

      if (c.c === idx + 1) {
        ws[cell].s = {
          ...(ws[cell].s || {}),
          fill: {
            fgColor: {
              rgb: isSunday
                ? "FFCCCC"
                : "EEEEEE"
            }
          }
        };
      }
    });
  });
}


};
