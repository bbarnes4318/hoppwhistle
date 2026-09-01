/**
 * CSV parsing for the lead import screen.
 *
 * The row count this returns is the number of leads the screen says it is about
 * to send, and the number it actually sends — so a miscount here is not a
 * display bug, it is leads invented or leads lost.
 *
 * It lives in its own module so it can be tested without mounting the dialog.
 */

/**
 * Parse CSV text into rows of trimmed cells, header row included.
 *
 * Handles quoted fields containing commas, newlines and doubled quotes. Skips
 * rows that carry no data at all.
 */
export function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let currentValue = '';
  // Whether the next character starts a new field. Only a quote in that
  // position opens a quoted section.
  let atFieldStart = true;

  const endRow = () => {
    row.push(currentValue.trim());
    currentValue = '';
    // A row whose cells are all empty is not a lead. Excel writes runs of
    // ",,,,,,,," below the data for every row whose formatting it has ever
    // touched, and the old test — "keep it if it has more than one cell" —
    // kept every one of them. That is what made an import report far more rows
    // than the file actually contains.
    if (row.some(cell => cell !== '')) lines.push(row);
    row = [];
    atFieldStart = true;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        i++;
      } else if (inQuotes || atFieldStart) {
        inQuotes = !inQuotes;
      } else {
        // A quote inside an unquoted value — 5'10", or John "JD" Smith — is
        // literal text. Treating it as an opening quote swallowed every
        // newline until the next quote appeared, silently merging rows and
        // losing the leads in between.
        currentValue += char;
      }
      atFieldStart = false;
    } else if (char === ',' && !inQuotes) {
      row.push(currentValue.trim());
      currentValue = '';
      atFieldStart = true;
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      endRow();
    } else {
      currentValue += char;
      atFieldStart = false;
    }
  }

  // Last line of a file that does not end in a newline.
  if (currentValue !== '' || row.length > 0) endRow();

  return lines;
}
