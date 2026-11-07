// Reads the table of a raw LaTeX block (`tabular`, `tabular*`, `tabularx`, `array`, optionally in a `table` with a
// caption) into a model the note previews; anything else, or LaTeX it cannot read, gives null and the block stays source.
// It also reads and writes the width and alignment the editor sets on such a table.

import { braceArg, fail, LatexSyntaxError, parseLatexInline, skipOptional, skipSpace, splitTopLevel } from "./latexSyntax.js";

/** Inline content of a cell or caption: text, math (TeX without delimiters) and styled groups. */
export type LatexInline =
  | { type: "text"; text: string }
  | { type: "math"; tex: string }
  | { type: "bold" | "italic" | "mono"; children: LatexInline[] };

type LatexAlign = "left" | "center" | "right" | "justify";

interface LatexColumn {
  align: LatexAlign;
  /** A CSS width for `p`, `m` and `b` columns whose width has an absolute unit. */
  width?: string;
}

export interface LatexCell {
  /** The 0-based column the cell starts at. */
  column: number;
  colspan: number;
  rowspan: number;
  align: LatexAlign;
  /** Vertical bars drawn at the cell's left and right edges (0 none, 2 double). */
  leftRule: number;
  rightRule: number;
  content: LatexInline[];
}

type LatexRuleKind = "hline" | "toprule" | "midrule" | "bottomrule" | "cline" | "cmidrule";

/** A horizontal rule over the 1-based columns `from`..`to` (inclusive). */
export interface LatexRule { kind: LatexRuleKind; from: number; to: number }

export interface LatexTable {
  caption?: LatexInline[];
  captionPosition: "above" | "below";
  columns: LatexColumn[];
  rows: LatexCell[][];
  /** `rules[i]` lie above row i; `rules[rows.length]` lie under the last row. */
  rules: LatexRule[][];
}

const TABLE_ENVS = ["tabular", "tabular*", "tabularx", "array"];
/** The block's LaTeX without leading `#|` option lines and `%` comments. */
function cleanSource(source: string): string {
  const lines = source.split(/\r?\n/);
  let first = 0;
  while (first < lines.length && /^\s*#\|/.test(lines[first] ?? "")) first++;
  return lines.slice(first).map((line) => line.replace(/(^|[^\\])%.*$/, "$1")).join("\n");
}

/** The first table environment: its name, its argument end and its body range. */
function findEnvironment(text: string): { name: string; begin: number; argsFrom: number; bodyEnd: number; end: number } | null {
  const begin = /\\begin\s*\{(tabular\*?|tabularx|array)\}/g;
  const m = begin.exec(text);
  if (!m) return null;
  const name = m[1]!;
  const pattern = new RegExp(`\\\\(begin|end)\\s*\\{${name.replace("*", "\\*")}\\}`, "g");
  pattern.lastIndex = m.index + m[0].length;
  let depth = 1;
  for (let e = pattern.exec(text); e; e = pattern.exec(text)) {
    depth += e[1] === "begin" ? 1 : -1;
    if (depth === 0) return { name, begin: m.index, argsFrom: m.index + m[0].length, bodyEnd: e.index, end: e.index + e[0].length };
  }
  return fail(`missing \\end{${name}}`);
}

const UNIT = /^\s*(\d*\.?\d+)\s*(cm|mm|in|pt|em|ex|px)\s*$/;

/** A column spec's columns with the count of `|` at each of the columns.length + 1 boundaries. */
function parseColumnSpec(spec: string): { columns: LatexColumn[]; bars: number[] } {
  const columns: LatexColumn[] = [];
  const bars: number[] = [0];
  const column = (align: LatexAlign, width?: string): void => {
    columns.push(width === undefined ? { align } : { align, width });
    bars.push(0);
  };
  const read = (text: string, depth: number): void => {
    if (depth > 4) fail("column spec nests too deep");
    let i = 0;
    while (i < text.length) {
      const c = text.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === "|") { bars[bars.length - 1]!++; i++; continue; }
      if (c === "l" || c === "c" || c === "r" || c === "S") { column(c === "l" ? "left" : c === "r" ? "right" : "center"); i++; continue; }
      if (c === "X") { column("justify"); i++; continue; }
      if (c === "p" || c === "m" || c === "b") {
        const arg = braceArg(text, i + 1);
        const unit = UNIT.exec(arg.value);
        column("justify", unit ? `${unit[1]}${unit[2]}` : undefined);
        i = arg.end;
        continue;
      }
      if (c === "@" || c === "!" || c === ">" || c === "<") { i = braceArg(text, i + 1).end; continue; }
      if (c === "*") {
        const count = braceArg(text, i + 1);
        const repeated = braceArg(text, count.end);
        const n = Number.parseInt(count.value.trim(), 10);
        if (!Number.isFinite(n) || n < 0 || n > 100) fail("bad column repeat");
        for (let k = 0; k < n; k++) read(repeated.value, depth + 1);
        i = repeated.end;
        continue;
      }
      if (/[A-Za-z]/.test(c)) { column("center"); i++; continue; }
      fail(`unexpected column spec character ${c}`);
    }
  };
  read(spec, 0);
  return { columns, bars };
}

/** The body's arguments after `\begin{env}`: the column spec and where the rows start. */
function readEnvArgs(text: string, name: string, from: number): { spec: string; bodyFrom: number } {
  let i = from;
  if (name === "tabular*" || name === "tabularx") i = braceArg(text, i).end;
  i = skipOptional(text, i).end;
  const at = skipSpace(text, i);
  if (text.charAt(at) !== "{") fail("missing column spec");
  const spec = braceArg(text, at);
  return { spec: spec.value, bodyFrom: spec.end };
}

const FULL_RULES: Readonly<Record<string, LatexRuleKind>> = { hline: "hline", toprule: "toprule", midrule: "midrule", bottomrule: "bottomrule" };
const SKIPPED_ROW_COMMANDS = new Set(["addlinespace", "noalign", "rowcolor", "morecmidrules", "specialrule", "hhline"]);

/** Strips the rules at the start of a row: they lie above it. */
function leadingRules(row: string, columns: number): { rules: LatexRule[]; rest: string } {
  const rules: LatexRule[] = [];
  let i = 0;
  for (;;) {
    i = skipSpace(row, i);
    const word = /^\\([A-Za-z]+)/.exec(row.slice(i));
    if (!word) break;
    const name = word[1]!;
    let j = i + word[0].length;
    if (FULL_RULES[name]) {
      j = skipOptional(row, j).end;
      rules.push({ kind: FULL_RULES[name], from: 1, to: columns });
    } else if (name === "cline" || name === "cmidrule") {
      if (name === "cmidrule") { j = skipOptional(row, j).end; j = skipOptional(row, j, "(", ")").end; }
      const range = braceArg(row, j);
      const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(range.value);
      if (!m) fail(`bad \\${name} range`);
      rules.push({ kind: name, from: Number(m![1]), to: Number(m![2]) });
      j = range.end;
    } else if (SKIPPED_ROW_COMMANDS.has(name)) {
      j = skipOptional(row, j).end;
      if (name === "noalign" || name === "rowcolor" || name === "specialrule" || name === "hhline") {
        const count = name === "specialrule" ? 3 : 1;
        for (let k = 0; k < count; k++) j = braceArg(row, j).end;
      }
    } else break;
    i = j;
  }
  return { rules, rest: row.slice(i) };
}

/** Reads `\cmd` with brace arguments (optional `[…]` skipped around them) when it is the whole of `text`. */
function wholeCommand(text: string, name: string, args: number): string[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(`\\${name}`) || /[A-Za-z]/.test(trimmed.charAt(name.length + 1))) return null;
  const values: string[] = [];
  let i = name.length + 1;
  while (values.length < args) {
    i = skipOptional(trimmed, i).end;
    const arg = braceArg(trimmed, i);
    values.push(arg.value);
    i = arg.end;
  }
  i = skipOptional(trimmed, i).end;
  return skipSpace(trimmed, i) === trimmed.length ? values : null;
}

/** One row's cells from its LaTeX, with the bars of the column spec. */
function readCells(row: string, columns: LatexColumn[], bars: number[]): { cells: LatexCell[]; empty: boolean[] } {
  const cells: LatexCell[] = [];
  const empty: boolean[] = [];
  let column = 0;
  for (const raw of splitTopLevel(row, false)) {
    let text = raw;
    let colspan = 1;
    let align = columns[column]?.align ?? "left";
    let leftRule = column === 0 ? (bars[0] ?? 0) : 0;
    let rightRule: number | undefined;
    const multicolumn = wholeCommand(text, "multicolumn", 3);
    if (multicolumn) {
      colspan = Number.parseInt(multicolumn[0]!.trim(), 10);
      if (!Number.isFinite(colspan) || colspan < 1) fail("bad \\multicolumn count");
      const spec = parseColumnSpec(multicolumn[1]!);
      align = spec.columns[0]?.align ?? "center";
      if (column === 0) leftRule = spec.bars[0] ?? 0;
      rightRule = spec.bars[spec.bars.length - 1] ?? 0;
      text = multicolumn[2]!;
    }
    let rowspan = 1;
    const multirow = wholeCommand(text, "multirow", 3);
    if (multirow) {
      rowspan = Number.parseInt(multirow[0]!.trim(), 10);
      if (!Number.isFinite(rowspan) || rowspan === 0) fail("bad \\multirow count");
      text = multirow[2]!;
    }
    rightRule ??= bars[column + colspan] ?? 0;
    const content = parseLatexInline(text);
    cells.push({ column, colspan, rowspan, align, leftRule, rightRule, content });
    empty.push(content.length === 0 && !multicolumn);
    column += colspan;
  }
  return { cells, empty };
}

/** Removes the empty cells a multirow covers; a negative count (`\multirow{-n}`) moves the cell up to its first row. */
function applyRowspans(rows: LatexCell[][], empties: boolean[][]): void {
  const covers = (cell: LatexCell, other: LatexCell): boolean => other.column >= cell.column && other.column + other.colspan <= cell.column + cell.colspan;
  const removeCovered = (cell: LatexCell, r: number): void => {
    const row = rows[r];
    const empty = empties[r];
    if (!row || !empty) return;
    for (let k = row.length - 1; k >= 0; k--) {
      if (row[k] !== cell && empty[k] && covers(cell, row[k]!)) { row.splice(k, 1); empty.splice(k, 1); }
    }
  };
  for (let r = 0; r < rows.length; r++) {
    for (const cell of [...rows[r]!]) {
      if (cell.rowspan > 1) {
        const span = Math.min(cell.rowspan, rows.length - r);
        cell.rowspan = span;
        for (let k = 1; k < span; k++) removeCovered(cell, r + k);
      } else if (cell.rowspan < 0) {
        const span = Math.min(-cell.rowspan, r + 1);
        const top = r - span + 1;
        cell.rowspan = span;
        if (span === 1) continue;
        const row = rows[r]!;
        const index = row.indexOf(cell);
        row.splice(index, 1, { ...cell, content: [] });
        empties[r]!.splice(index, 1, true);
        removeCovered(cell, top);
        const target = rows[top]!;
        const at = target.findIndex((other) => other.column > cell.column);
        target.splice(at < 0 ? target.length : at, 0, cell);
        empties[top]!.splice(at < 0 ? empties[top]!.length : at, 0, false);
        for (let k = 1; k < span; k++) removeCovered(cell, top + k);
      }
    }
  }
}

/** The caption of the `table` around the environment and whether it comes before the rows. */
function readCaption(text: string, envBegin: number, envEnd: number): { caption?: LatexInline[]; position: "above" | "below" } {
  const outside = (index: number): boolean => index < envBegin || index >= envEnd;
  const pattern = /\\caption\*?(?![A-Za-z])/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (!outside(m.index)) continue;
    const arg = braceArg(text, skipOptional(text, m.index + m[0].length).end);
    return { caption: parseLatexInline(arg.value), position: m.index < envBegin ? "above" : "below" };
  }
  return { position: "below" };
}

/**
 * Reads a raw LaTeX block's table. Leading `#|` option lines and `%` comments are ignored; `\centering` and `\label` are dropped.
 * @returns the first `tabular`, `tabular*`, `tabularx` or `array` with its caption, or null when there is none, the block
 * draws a picture, or its LaTeX cannot be read.
 */
export function parseLatexTable(source: string): LatexTable | null {
  const text = cleanSource(source);
  if (/\\begin\s*\{tikzpicture\}/.test(text)) return null;
  try {
    const env = findEnvironment(text);
    if (!env || !TABLE_ENVS.includes(env.name)) return null;
    const { spec, bodyFrom } = readEnvArgs(text, env.name, env.argsFrom);
    const { columns, bars } = parseColumnSpec(spec);
    if (columns.length === 0) return null;
    const rows: LatexCell[][] = [];
    const empties: boolean[][] = [];
    const rules: LatexRule[][] = [];
    let pending: LatexRule[] = [];
    for (const chunk of splitTopLevel(text.slice(bodyFrom, env.bodyEnd), true)) {
      const { rules: above, rest } = leadingRules(chunk, columns.length);
      pending.push(...above);
      if (rest.trim() === "") continue;
      const { cells, empty } = readCells(rest, columns, bars);
      rows.push(cells);
      empties.push(empty);
      rules.push(pending);
      pending = [];
    }
    if (rows.length === 0) return null;
    rules.push(pending);
    applyRowspans(rows, empties);
    const { caption, position } = readCaption(text, env.begin, env.end);
    return caption ? { caption, captionPosition: position, columns, rows, rules } : { captionPosition: position, columns, rows, rules };
  } catch (error) {
    if (error instanceof LatexSyntaxError) return null;
    throw error;
  }
}

// The width and alignment the editor writes into a raw LaTeX table, so the PDF follows: the table environment wrapped in
// `\resizebox{0.6\linewidth}{!}{%` … `%` `}` (none at full width), and `\raggedright`, `\centering` or `\raggedleft`
// as the first line of a `table` environment, or a bare tabular wrapped in `flushleft`, `center` or `flushright`.

/** Where a LaTeX table sits on the line; centre is the default. */
type LatexTableAlign = "left" | "center" | "right";

/** A table's width in percent of the line (null at its natural width) and its alignment. */
export interface LatexTableLayout { readonly width: number | null; readonly align: LatexTableAlign }

const ALIGN_COMMANDS = { left: "raggedright", center: "centering", right: "raggedleft" } as const;
const ALIGN_ENVS = { left: "flushleft", center: "center", right: "flushright" } as const;
const RESIZE_OPEN = /\\resizebox\s*\{\s*(\d*\.?\d+)\s*\\(?:linewidth|textwidth|columnwidth)\s*\}\s*\{\s*!\s*\}\s*\{%?\s*$/;
const RESIZE_CLOSE = /^%?\s*\}/;
const TABLE_BEGIN = /\\begin\s*\{table\*?\}(?:[ \t]*\[[^\]\n]*\])?/;
const ALIGN_COMMAND = /\\(raggedright|centering|raggedleft)(?![A-Za-z])/;
const WRAP_OPEN = /^(\s*)\\begin\s*\{(flushleft|center|flushright)\}[ \t]*\n?/;

/** The first table environment of the raw source, or null. */
function rawEnvironment(source: string): ReturnType<typeof findEnvironment> {
  try {
    return findEnvironment(source);
  } catch (error) {
    if (error instanceof LatexSyntaxError) return null;
    throw error;
  }
}

/** The `\resizebox` around the environment: its range and its factor in percent, or null. */
function findResize(source: string, env: { begin: number; end: number }): { from: number; to: number; percent: number } | null {
  const open = RESIZE_OPEN.exec(source.slice(0, env.begin));
  const close = RESIZE_CLOSE.exec(source.slice(env.end));
  if (!open || !close) return null;
  return { from: open.index, to: env.end + close[0].length, percent: Math.round(parseFloat(open[1]!) * 100) };
}

/** The end of the `\begin{table}[…]` before `before`, or null when the table is not in one. */
function tableOpenerEnd(source: string, before: number): number | null {
  const table = TABLE_BEGIN.exec(source);
  return table && table.index < before ? table.index + table[0].length : null;
}

/** The `flushleft`, `center` or `flushright` environment around a whole block (after its `#|` lines), or null. */
function findWrapper(source: string): { align: LatexTableAlign; openFrom: number; openTo: number; closeFrom: number; closeTo: number } | null {
  const head = /^(?:[ \t]*#\|[^\n]*\n)*/.exec(source)![0].length;
  const open = WRAP_OPEN.exec(source.slice(head));
  if (!open) return null;
  const close = new RegExp(`\\n?[ \\t]*\\\\end\\s*\\{${open[2]}\\}[ \\t]*(?=\\s*$)`).exec(source);
  if (!close || close.index < head + open[0].length) return null;
  const align = open[2] === "flushleft" ? "left" : open[2] === "flushright" ? "right" : "center";
  return { align, openFrom: head + open[1]!.length, openTo: head + open[0].length, closeFrom: close.index, closeTo: close.index + close[0].length };
}

/** The width and alignment of a raw LaTeX table as the editor writes them; an unknown form reads as natural width, centred. */
export function readLatexTableLayout(source: string): LatexTableLayout {
  const env = rawEnvironment(source);
  if (!env) return { width: null, align: "center" };
  const percent = findResize(source, env)?.percent ?? 100;
  const width = percent > 0 && percent < 100 ? percent : null;
  const start = tableOpenerEnd(source, env.begin);
  if (start === null) return { width, align: findWrapper(source)?.align ?? "center" };
  const command = ALIGN_COMMAND.exec(source.slice(start, env.begin))?.[1];
  return { width, align: command === "raggedright" ? "left" : command === "raggedleft" ? "right" : "center" };
}

/** `source` with `layout` written in: the resize box set or removed, the alignment command replaced in place or added, or the wrapper set. A source without a table is returned as is. */
export function setLatexTableLayout(source: string, layout: LatexTableLayout): string {
  const env = rawEnvironment(source);
  if (!env) return source;
  const resize = findResize(source, env);
  const from = resize?.from ?? env.begin;
  const inner = source.slice(env.begin, env.end);
  const width = layout.width !== null && layout.width > 0 && layout.width < 100 ? layout.width : null;
  const boxed = width === null ? inner : `\\resizebox{${width / 100}\\linewidth}{!}{%\n${inner}%\n}`;
  const text = source.slice(0, from) + boxed + source.slice(resize?.to ?? env.end);
  const start = tableOpenerEnd(text, from);
  if (start !== null) {
    const command = `\\${ALIGN_COMMANDS[layout.align]}`;
    const found = ALIGN_COMMAND.exec(text.slice(start, from));
    if (found) return text.slice(0, start + found.index) + command + text.slice(start + found.index + found[0].length);
    return `${text.slice(0, start)}\n${command}${text.slice(start)}`;
  }
  const name = ALIGN_ENVS[layout.align];
  const wrapper = findWrapper(text);
  if (wrapper) return `${text.slice(0, wrapper.openFrom)}\\begin{${name}}\n${text.slice(wrapper.openTo, wrapper.closeFrom)}\n\\end{${name}}${text.slice(wrapper.closeTo)}`;
  const head = /^(?:[ \t]*#\|[^\n]*\n)*\s*/.exec(text)![0].length;
  const end = Math.max(head, text.trimEnd().length);
  return `${text.slice(0, head)}\\begin{${name}}\n${text.slice(head, end)}\n\\end{${name}}${text.slice(end)}`;
}
