// A data figure that follows a table of its document (the model's `table` label): the cells of a pipe table or a LaTeX tabular
// read as a chart table, the LaTeX tables of a text with their labels, and the figure a table starts with.
// CONTRACT: documents/contracts/qmd-items.md#figures
import { lineStart } from '../../text/index.js';
import { parseLatexTable, type LatexInline } from '../latexTable/index.js';
import { columnLetter } from './csv.js';
import { emptyLayout, type FigureModel } from './figureModel.js';
import type { ChartTable, ChartTrace } from './model.js';

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A cell's text as a chart value: blank is null; a number, also in math, `\num{…}`, with a Unicode minus or a `{,}` decimal comma, is a number; else the text. */
export function cellValue(text: string): number | string | null {
  const t = text.trim();
  if (t === '') return null;
  const bare = t.replace(/^\$(.*)\$$/s, '$1').replace(/^\\num\{(.*)\}$/s, '$1').replace(/[−–]/g, '-').replace(/\{,\}/g, '.').replace(/\\[,;!]|~|\s/g, '');
  return NUMBER.test(bare) ? Number(bare) : t;
}

/** The first row names the columns when `header` says so; when it is absent, when none of its cells is a number and one has text. */
export function tableOfRows(rows: readonly (readonly string[])[], header?: boolean): ChartTable {
  const width = rows.reduce((m, row) => Math.max(m, row.length), 0);
  const first = rows[0] ?? [];
  const named = header ?? (first.every((cell) => typeof cellValue(cell) !== 'number') && first.some((cell) => cellValue(cell) !== null));
  const body = named ? rows.slice(1) : rows;
  const cols = Array.from({ length: width }, (_, c) => ({
    name: named ? (first[c] ?? '').trim() || columnLetter(c) : columnLetter(c),
    values: body.map((row) => cellValue(row[c] ?? '')),
  }));
  return { cols };
}

export const sameTable = (a: ChartTable | undefined, b: ChartTable): boolean => JSON.stringify(a ?? null) === JSON.stringify(b);

const isNumeric = (col: ChartTable['cols'][number]): boolean => col.values.some((value) => typeof value === 'number');

/**
 * The figure a table starts with, following the table labelled `label`: the first column against each other column that holds
 * a number, as lines and markers over a numeric first column and as bars over text. No series when no other column has numbers.
 */
export function figureOfTable(table: ChartTable, label: string, id: string): FigureModel {
  const [first, ...rest] = table.cols;
  const bars = first !== undefined && !isNumeric(first);
  const traces = rest.flatMap((col, i): ChartTrace[] => (isNumeric(col)
    ? [{ type: bars ? 'bar' : 'scatter', ...(bars ? {} : { mode: 'lines+markers' }), name: col.name, x: 'A', y: columnLetter(i + 1) }]
    : []));
  const layout = emptyLayout(2);
  if (first !== undefined) layout.xaxis = { ...layout.xaxis, title: first.name };
  if (traces.length === 1) layout.yaxis = { ...layout.yaxis, title: traces[0]!.name! };
  return { v: 1, id, kind: 'data', data: table, traces, fns: [], vars: [], layout, table: label };
}

const CAPTION_LABEL = /^(?:Table)?:\s.*\{[^{}]*#(tbl-[A-Za-z0-9_:.-]+)[^{}]*\}\s*$/s;

/** The `#tbl-` id of a Quarto table caption paragraph (`: Caption {#tbl-x}`), or null. */
export function captionLabel(text: string): string | null {
  return CAPTION_LABEL.exec(text.trim())?.[1] ?? null;
}

function inlineText(nodes: readonly LatexInline[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.text : node.type === 'math' ? `$${node.tex}$` : inlineText(node.children))).join('');
}

/** The chart table of a LaTeX source holding a tabular, or null when parseLatexTable cannot read one. */
export function tableOfLatex(source: string): ChartTable | null {
  const parsed = parseLatexTable(source);
  if (parsed === null) return null;
  const rows = parsed.rows.map((row) => {
    const cells = Array<string>(parsed.columns.length).fill('');
    for (const cell of row) cells[cell.column] = inlineText(cell.content);
    return cells;
  });
  return tableOfRows(rows);
}

/** A LaTeX table in a text: its lines (`from` at a line start, `to` at a line end), its `\label`, where a new label line goes and its cells. */
export interface LatexTableSpan { from: number; to: number; label: string | null; labelAt: number; labelIndent: string; table: ChartTable | null }

const TABULAR = /\\begin\s*\{(tabular\*?|tabularx|array)\}/g;
const LABEL = /\\label\s*\{([^{}]*)\}/g;

/** The offset of the newline ending the line that holds `at`, or the text length on the last line. */
const lineStop = (text: string, at: number): number => { const end = text.indexOf('\n', at); return end < 0 ? text.length : end; };

/** Whether `at` is in a `%` comment: an unescaped `%` earlier on its line. */
function inComment(text: string, at: number): boolean {
  return /(^|[^\\])%/.test(text.slice(lineStart(text, at), at));
}

/** The first match of `pattern` from `from` that is not in a comment, or null. */
function findCode(text: string, pattern: RegExp, from: number): RegExpExecArray | null {
  const re = new RegExp(pattern.source, 'g');
  re.lastIndex = from;
  for (let m = re.exec(text); m; m = re.exec(text)) if (!inComment(text, m.index)) return m;
  return null;
}

/** The `table` or `table*` float around [begin, end): the start of its \begin line and the start and end of its \end line. */
function enclosingFloat(text: string, begin: number, end: number): { from: number; endLine: number; to: number } | null {
  let open: RegExpExecArray | null = null;
  for (let m = findCode(text, /\\(begin|end)\s*\{table\*?\}/, 0); m && m.index < begin; m = findCode(text, /\\(begin|end)\s*\{table\*?\}/, m.index + 1)) open = m[1] === 'begin' ? m : null;
  if (open === null) return null;
  const close = findCode(text, /\\end\s*\{table\*?\}/, end);
  return close === null ? null : { from: lineStart(text, open.index), endLine: lineStart(text, close.index), to: lineStop(text, close.index) };
}

/** The first `\label` in [from, to) that is not in a comment. */
function labelIn(text: string, from: number, to: number): string | null {
  const m = findCode(text, LABEL, from);
  return m !== null && m.index < to ? m[1]!.trim() : null;
}

const indentAt = (text: string, at: number): string => /^[ \t]*/.exec(text.slice(lineStart(text, at)))![0];

/** One LaTeX table: a tabular inside a float takes the float's lines and labels (a new label goes before `\end{table}`, after the caption); a bare one takes a `\label` line just above it. */
function spanAt(text: string, m: RegExpExecArray): { span: LatexTableSpan; next: number } | null {
  const close = findCode(text, new RegExp(`\\\\end\\s*\\{${m[1]!.replace('*', '\\*')}\\}`), m.index + m[0].length);
  if (close === null) return null;
  const end = close.index + close[0].length;
  const float = enclosingFloat(text, m.index, end);
  const from = float?.from ?? lineStart(text, m.index);
  const to = float?.to ?? lineStop(text, end);
  const table = tableOfLatex(text.slice(from, to));
  if (float !== null) {
    const span = { from, to, label: labelIn(text, from, to), labelAt: float.endLine, labelIndent: `${indentAt(text, float.endLine)}  `, table };
    return { span, next: to };
  }
  const above = from > 0 ? text.slice(lineStart(text, from - 1), from - 1) : '';
  const label = /^\s*\\label\s*\{([^{}]*)\}\s*$/.exec(above)?.[1]?.trim() ?? null;
  return { span: { from, to, label, labelAt: from, labelIndent: indentAt(text, from), table }, next: to };
}

/** The LaTeX tables of a text in order, comments skipped; a table without a closing `\end` ends the list. */
export function findLatexTables(text: string): LatexTableSpan[] {
  const spans: LatexTableSpan[] = [];
  for (let m = findCode(text, TABULAR, 0); m; ) {
    const found = spanAt(text, m);
    if (found === null) break;
    spans.push(found.span);
    m = findCode(text, TABULAR, found.next);
  }
  return spans;
}

/** The line that gives a LaTeX table without one the label `label`: where it goes and its text. */
export function labelLine(span: LatexTableSpan, label: string): { at: number; text: string } {
  return { at: span.labelAt, text: `${span.labelIndent}\\label{${label}}\n` };
}

/** A new table label of the kind the document uses: `tab:<id>` in LaTeX, `tbl-<id>` in a note's Markdown. */
export const newTableLabel = (kind: 'latex' | 'markdown', id: string): string => (kind === 'latex' ? `tab:${id}` : `tbl-${id}`);
