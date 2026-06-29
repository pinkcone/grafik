/** Eksport wierszy do CSV (średnik — Excel PL) i pobranie w przeglądarce. */
const escapeCsvValue = (value) => {
  const str = value == null ? '' : String(value);
  if (/[",\n\r;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const rowsToCsv = (rows, delimiter = ';') =>
  rows.map((row) => row.map(escapeCsvValue).join(delimiter)).join('\r\n');

export const downloadCsv = (filename, rows) => {
  const bom = '\uFEFF';
  const csv = bom + rowsToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};
