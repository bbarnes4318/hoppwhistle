/**
 * The row count this parser returns is the number of leads the import screen
 * says it is about to send, and the number it actually sends. When it is wrong,
 * it is wrong in one of two expensive directions: phantom rows become phantom
 * leads, and swallowed newlines merge two real leads into one and lose the
 * other.
 *
 * Both directions were live. These pin them.
 */
import { describe, expect, it } from 'vitest';

import { parseCSV } from '../parse-csv';

const HEADER = 'FirstName,LastName,Primary_Phone';

describe('parseCSV', () => {
  it('counts exactly the rows in the file', () => {
    const csv = [HEADER, 'Jane,Doe,5125551234', 'John,Roe,5125555678'].join('\n');
    expect(parseCSV(csv)).toHaveLength(3); // header + 2
  });

  describe('does not invent rows', () => {
    it('ignores the trailing comma-only lines Excel writes', () => {
      // Excel emits these for every row whose formatting it has ever touched.
      // A sheet edited down to row 5000 exports 4998 of them after the data.
      const csv = [HEADER, 'Jane,Doe,5125551234', ',,', ',,', ',,', ',,'].join('\n');

      const rows = parseCSV(csv);

      expect(rows).toHaveLength(2); // header + Jane, and nothing else
      expect(rows[1]).toEqual(['Jane', 'Doe', '5125551234']);
    });

    it('ignores blank lines wherever they appear', () => {
      const csv = [HEADER, '', 'Jane,Doe,5125551234', '', '', 'John,Roe,5125555678', ''].join('\n');
      expect(parseCSV(csv)).toHaveLength(3);
    });

    it('ignores whitespace-only cells', () => {
      const csv = [HEADER, 'Jane,Doe,5125551234', '  ,  ,  '].join('\n');
      expect(parseCSV(csv)).toHaveLength(2);
    });

    it('does not add a row for a trailing newline', () => {
      expect(parseCSV(`${HEADER}\nJane,Doe,5125551234\n`)).toHaveLength(2);
    });

    it('handles CRLF without doubling', () => {
      expect(parseCSV(`${HEADER}\r\nJane,Doe,5125551234\r\n`)).toHaveLength(2);
    });
  });

  describe('does not lose rows', () => {
    it('treats a quote inside an unquoted value as literal text', () => {
      // An unbalanced quote used to flip the parser into quoted mode, so every
      // newline after it was swallowed until the next quote turned up. Two
      // leads became one, and the second one's data was appended to the first.
      const csv = [HEADER, 'Jane,O"Doe,5125551234', 'John,Roe,5125555678'].join('\n');

      const rows = parseCSV(csv);

      expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual(['Jane', 'O"Doe', '5125551234']);
      expect(rows[2]).toEqual(['John', 'Roe', '5125555678']);
    });

    it('keeps the last line when the file does not end in a newline', () => {
      expect(parseCSV(`${HEADER}\nJane,Doe,5125551234`)).toHaveLength(2);
    });
  });

  describe('still parses real quoted CSV', () => {
    it('keeps a comma inside a quoted field', () => {
      const csv = [
        'FirstName,Address,City',
        'Jane,"123 Main St, Apt 4",Austin',
        'John,456 Oak Ave,Dallas',
      ].join('\n');

      const rows = parseCSV(csv);

      expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual(['Jane', '123 Main St, Apt 4', 'Austin']);
    });

    it('keeps a newline inside a quoted field', () => {
      const csv = ['FirstName,Notes', 'Jane,"line one\nline two"', 'John,plain'].join('\n');

      const rows = parseCSV(csv);

      expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual(['Jane', 'line one\nline two']);
    });

    it('unescapes a doubled quote', () => {
      const rows = parseCSV('FirstName,Notes\nJane,"she said ""hi"""');
      expect(rows[1]).toEqual(['Jane', 'she said "hi"']);
    });

    it('keeps an empty quoted field', () => {
      const rows = parseCSV('FirstName,Middle,LastName\nJane,"",Doe');
      expect(rows[1]).toEqual(['Jane', '', 'Doe']);
    });
  });

  it('keeps a row that has data in only one column', () => {
    const rows = parseCSV(`${HEADER}\n,,5125551234`);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['', '', '5125551234']);
  });
});
