/**
 * A CSV cell that cannot be read as a formula by a spreadsheet.
 *
 * A leading =, +, - or @ makes Excel and Sheets evaluate the cell. Names in
 * these exports -- an agent's, a buyer's, a publisher's -- are user-supplied
 * and go in column one of a file somebody opens, so a leading formula
 * character is escaped with a quote and every cell is quoted.
 *
 * Moved here from `routes/leaderboard.ts` so every export that writes a name
 * guards it the same way.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}
