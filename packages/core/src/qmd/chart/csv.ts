// CSV for chart tables (plan charts, D4): RFC 4180 parsing with delimiter sniffing, header detection and typed cells, and the format back to CSV.
import type { ChartTable } from "./model.js";

/** The spreadsheet letter of a column index: 0 is A, 25 is Z, 26 is AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

type Delimiter = ',' | ';' | '\t';

const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];
const SNIFF_RECORDS = 20;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const COMMA_NUMBER = /^[+-]?(\d+,\d*|,\d+)([eE][+-]?\d+)?$/;

interface Records { rows: string[][]; blank: boolean[]; errors: { row: number; message: string }[] }

/** Splits text into records of fields (quotes, doubled quotes, embedded newlines, CRLF); stops after `limit` records when given. `blank` marks a record that is one empty unquoted field. */
function tokenize(text: string, delimiter: Delimiter, limit = Infinity): Records {
  const rows: string[][] = [];
  const blank: boolean[] = [];
  const errors: { row: number; message: string }[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  let any = false;
  let i = 0;
  const endField = (): void => { row.push(field); field = ''; };
  const endRow = (): void => {
    endField();
    rows.push(row);
    blank.push(row.length === 1 && row[0] === '' && !quoted);
    row = [];
    quoted = false;
    any = false;
  };
  while (i < text.length && rows.length < limit) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
      } else { field += ch; }
      i += 1;
      continue;
    }
    any = true;
    if (ch === '"' && field === '') { inQuotes = true; quoted = true; }
    else if (ch === delimiter) { endField(); }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') { i += 1; }
      endRow();
    } else { field += ch; }
    i += 1;
  }
  if (inQuotes) { errors.push({ row: rows.length + 1, message: 'Unterminated quoted field' }); }
  if ((any || inQuotes || field !== '' || row.length > 0) && rows.length < limit) { endRow(); }
  return { rows, blank, errors };
}

/** The delimiter whose first records split into the most columns with the same count; a comma when none splits. */
function sniff(text: string): Delimiter {
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const { rows, blank } = tokenize(text, d, SNIFF_RECORDS);
    const used = rows.filter((_, k) => !blank[k]);
    const width = used[0]?.length ?? 0;
    if (width < 2) { continue; }
    const score = used.filter((r) => r.length === width).length * 1000 + width;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** A cell read as a number, or null when the text is not one; ';' files also accept a comma decimal. */
function toNumber(text: string, delimiter: Delimiter): number | null {
  const t = text.trim();
  if (NUMBER.test(t)) { return Number(t); }
  if (delimiter === ';' && COMMA_NUMBER.test(t)) { return Number(t.replace(',', '.')); }
  return null;
}

function toCell(text: string, delimiter: Delimiter): number | string | null {
  if (text.trim() === '') { return null; }
  return toNumber(text, delimiter) ?? text;
}

/** Parses CSV text into a table; the first row names the columns when it is all text, else columns are named A, B, … and every row is data. */
export function parseCsv(text: string): { table: ChartTable; delimiter: ',' | ';' | '\t'; header: boolean; errors: { row: number; message: string }[] } {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = sniff(body);
  const { rows, blank, errors } = tokenize(body, delimiter);
  while (rows.length > 0 && blank[rows.length - 1]) { rows.pop(); }
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const head = rows[0];
  if (head === undefined) { return { table: { cols: [] }, delimiter, header: false, errors }; }
  const first = Array.from({ length: width }, (_, c) => head[c] ?? '');
  const header = first.every((cell) => cell.trim() !== '' && toNumber(cell, delimiter) === null);
  const data = header ? rows.slice(1) : rows;
  const cols = Array.from({ length: width }, (_, c) => ({
    name: header ? (first[c] ?? '') : columnLetter(c),
    values: data.map((r) => toCell(r[c] ?? '', delimiter)),
  }));
  return { table: { cols }, delimiter, header, errors };
}

function field(value: number | string | null, single: boolean): string {
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) { return single ? '""' : ''; }
  const s = String(value);
  if (s === '' && single) { return '""'; }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Writes a table as a comma CSV with a header row of column names and \n line endings. */
export function formatCsv(table: ChartTable): string {
  const single = table.cols.length === 1;
  const height = table.cols.reduce((m, c) => Math.max(m, c.values.length), 0);
  const lines = [table.cols.map((c) => field(c.name, single)).join(',')];
  for (let r = 0; r < height; r += 1) {
    lines.push(table.cols.map((c) => field(c.values[r] ?? null, single)).join(','));
  }
  return `${lines.join('\n')}\n`;
}
