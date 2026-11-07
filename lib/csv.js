// CSV building for staff exports.

// A cell starting with one of these is read as a formula by spreadsheet apps
// (CSV injection) — prefixed with a single quote so it stays text.
const FORMULA_START = /^[=+\-@\t\r]/

/** One CSV cell: formula-prefixed, then quoted when it holds a comma, quote or newline. */
export function csvCell(value) {
  if (value == null) return ''
  let s = String(value)
  if (FORMULA_START.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows (arrays of cells) → CSV text with CRLF line endings. */
export function toCsv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
