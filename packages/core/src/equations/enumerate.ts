/**
 * Lists the display equations of a flattened TeX text in order: environment, raw body, labels,
 * the numbers LaTeX gives them, the offset of the opening delimiter, and the LaTeX to show, with the
 * author's macros expanded (D6) and \label, \nonumber, \notag and \tag removed. Comments, verbatim
 * environments and \verb are skipped.
 */
import { removeComments } from "../latex/source.js";
import { collectMacros, expandMacros, readGroup, readLetters, skipSpaces, type MacroTable } from "./macros.js";
import { EquationNumbering } from "./numbering.js";

export interface SourceEquation { env: string; body: string; latex: string; labels: string[]; numbers: string[]; offset: number }

const DISPLAY_ENVIRONMENTS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*",
  "flalign", "flalign*", "alignat", "alignat*", "eqnarray", "eqnarray*", "displaymath",
]);
/** Environments numbered per row. */
const ROW_NUMBERED = new Set(["align", "gather", "flalign", "alignat", "eqnarray"]);
/** Environments with one number for the whole display. */
const ONE_NUMBER = new Set(["equation", "multline"]);
const CHAPTER_CLASSES = new Set(["book", "report", "memoir", "scrbook", "scrreprt"]);

const VERBATIM = /\\begin\{(verbatim\*?|Verbatim\*?|BVerbatim|lstlisting|minted|comment)\}|\\verb\*?([^A-Za-z\s*])/g;

export function listEquations(tex: string): SourceEquation[] {
  const masked = maskVerbatim(tex);
  const text = removeComments(masked);
  const macros = collectMacros(masked);
  const numbering = new EquationNumbering();
  const equations: SourceEquation[] = [];
  const add = (env: string, offset: number, start: number, end: number): void => {
    equations.push(buildEquation({ tex, text, macros, numbering }, env, offset, start, end));
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "$") {
      if (text[i + 1] === "$") {
        const close = text.indexOf("$$", i + 2);
        if (close < 0) break;
        add("$$", i, i + 2, close);
        i = close + 2;
      } else {
        i = inlineMathEnd(text, i + 1);
      }
      continue;
    }
    if (char !== "\\") { i += 1; continue; }
    if (text[i + 1] === "[") {
      const close = text.indexOf("\\]", i + 2);
      if (close < 0) break;
      add("\\[", i, i + 2, close);
      i = close + 2;
      continue;
    }
    const name = readLetters(text, i + 1);
    if (!name) { i += 2; continue; }
    const after = i + 1 + name.length;
    i = readCommand({ text, numbering, add }, name, i, after);
  }
  return equations;
}

interface ScanContext {
  text: string;
  numbering: EquationNumbering;
  add: (env: string, offset: number, start: number, end: number) => void;
}

/** Acts on `\begin{env}` at `at`: a display environment is added; returns the offset to continue from. */
function readBegin(ctx: ScanContext, at: number, after: number): number {
  const { text, numbering } = ctx;
  const group = readGroup(text, skipSpaces(text, after));
  if (!group) return after;
  const env = group.content.trim();
  if (env === "subequations") { numbering.beginSubequations(); return group.end; }
  if (!DISPLAY_ENVIRONMENTS.has(env)) return group.end;
  let start = group.end;
  if (env.startsWith("alignat")) start = readGroup(text, skipSpaces(text, start))?.end ?? start;
  const closing = `\\end{${env}}`;
  const close = text.indexOf(closing, start);
  if (close < 0) return group.end;
  ctx.add(env, at, start, close);
  return close + closing.length;
}

/** Acts on `\documentclass[options]{name}`: a class with chapters numbers equations by chapter. */
function readDocumentClass(ctx: ScanContext, after: number): number {
  const { text, numbering } = ctx;
  let j = skipSpaces(text, after);
  if (text[j] === "[") j = text.indexOf("]", j) + 1 || after;
  const group = readGroup(text, skipSpaces(text, j));
  if (!group) return after;
  if (CHAPTER_CLASSES.has(group.content.trim())) numbering.useChapters();
  return group.end;
}

/** Acts on the command `\name` at `at`; returns the offset to continue from. */
function readCommand(ctx: ScanContext, name: string, at: number, after: number): number {
  const { text, numbering } = ctx;
  switch (name) {
    case "begin": return readBegin(ctx, at, after);
    case "end": {
      const group = readGroup(text, skipSpaces(text, after));
      if (!group) return after;
      if (group.content.trim() === "subequations") numbering.endSubequations();
      return group.end;
    }
    case "chapter":
    case "section":
      if (text[after] !== "*") {
        if (name === "chapter") numbering.stepChapter();
        else numbering.stepSection();
      }
      return after;
    case "appendix":
      numbering.appendix();
      return after;
    case "numberwithin": {
      const counter = readGroup(text, skipSpaces(text, after));
      const unit = counter && readGroup(text, skipSpaces(text, counter.end));
      if (!counter || !unit) return after;
      if (counter.content.trim() === "equation") numbering.numberWithin(unit.content.trim());
      return unit.end;
    }
    case "documentclass": return readDocumentClass(ctx, after);
    default:
      return after;
  }
}

interface EquationContext { tex: string; text: string; macros: MacroTable; numbering: EquationNumbering }

interface Row { text: string; labels: string[]; tag: string | undefined; unnumbered: boolean }

function buildEquation(ctx: EquationContext, env: string, offset: number, start: number, end: number): SourceEquation {
  const base = env.replace(/\*$/, "");
  const starred = env.endsWith("*") || !(ROW_NUMBERED.has(base) || ONE_NUMBER.has(base));
  const work = ctx.text.slice(start, end);
  const multiRow = ROW_NUMBERED.has(base) || base === "multline";
  const rows = (multiRow ? splitRows(work) : [work]).map(parseRow);
  while (rows.length > 1 && isEmptyRow(rows[rows.length - 1])) rows.pop();
  const labels = rows.flatMap((row) => row.labels);
  const numbers: string[] = [];
  const numberRow = (tag: string | undefined, unnumbered: boolean): void => {
    if (tag !== undefined) numbers.push(tag);
    else if (!unnumbered && !starred) numbers.push(ctx.numbering.next());
  };
  if (ROW_NUMBERED.has(base)) {
    for (const row of rows) numberRow(row.tag, row.unnumbered);
  } else {
    numberRow(rows.find((row) => row.tag !== undefined)?.tag, rows.some((row) => row.unnumbered));
  }
  return {
    env,
    body: ctx.tex.slice(start, end),
    latex: expandMacros(joinRows(base, multiRow, rows), ctx.macros),
    labels,
    numbers,
    offset,
  };
}

function isEmptyRow(row: Row | undefined): boolean {
  return row !== undefined && row.text.trim() === "" && row.labels.length === 0 && row.tag === undefined;
}

/** Joins cleaned rows; several rows (or alignment marks) go in an aligned block, gathered for gather. */
function joinRows(base: string, multiRow: boolean, rows: readonly Row[]): string {
  const texts = rows.map((row) => row.text.trim());
  const needsBlock = texts.length > 1 || (multiRow && texts.some(hasTopLevelAmpersand));
  if (!needsBlock) return texts[0] ?? "";
  const block = base === "gather" ? "gathered" : "aligned";
  return `\\begin{${block}}${texts.join(" \\\\ ")}\\end{${block}}`;
}

/** Splits a body at `\\` outside braces and nested environments, dropping `*` and `[skip]` after it. */
function splitRows(body: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let rowStart = 0;
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (char === "{") { depth += 1; i += 1; continue; }
    if (char === "}") { depth -= 1; i += 1; continue; }
    if (char !== "\\") { i += 1; continue; }
    if (body[i + 1] === "\\") {
      if (depth !== 0 || envDepth !== 0) { i += 2; continue; }
      rows.push(body.slice(rowStart, i));
      i = skipRowBreakOptions(body, i + 2);
      rowStart = i;
      continue;
    }
    const name = readLetters(body, i + 1);
    if (name === "begin") envDepth += 1;
    else if (name === "end") envDepth -= 1;
    i += name ? 1 + name.length : 2;
  }
  rows.push(body.slice(rowStart));
  return rows;
}

function skipRowBreakOptions(body: string, at: number): number {
  let i = at;
  if (body[i] === "*") i += 1;
  const j = skipSpaces(body, i);
  if (body[j] === "[") {
    const close = body.indexOf("]", j);
    if (close >= 0) return close + 1;
  }
  return i;
}

const ROW_COMMAND = /\\(label|tag|nonumber|notag)(?![A-Za-z])(\*?)/g;

/** Reads a row's labels, tag and \nonumber or \notag, and returns its text without them. */
function parseRow(row: string): Row {
  const labels: string[] = [];
  let tag: string | undefined;
  let unnumbered = false;
  let text = "";
  let last = 0;
  for (const match of row.matchAll(ROW_COMMAND)) {
    if (match.index < last) continue;
    const [whole, command] = match;
    let end = match.index + whole.length;
    if (command === "label" || command === "tag") {
      const group = readGroup(row, skipSpaces(row, end));
      if (!group) continue;
      end = group.end;
      if (command === "label") labels.push(group.content.trim());
      else tag = group.content.trim();
    } else {
      unnumbered = true;
    }
    text += row.slice(last, match.index);
    last = end;
  }
  text += row.slice(last);
  return { text, labels, tag, unnumbered };
}

function hasTopLevelAmpersand(row: string): boolean {
  let depth = 0;
  let envDepth = 0;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === "\\") {
      const name = readLetters(row, i + 1);
      if (name === "begin") envDepth += 1;
      else if (name === "end") envDepth -= 1;
      i += name ? name.length : 1;
    } else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "&" && depth === 0 && envDepth === 0) return true;
  }
  return false;
}

/** Offset after the `$` that closes inline math opened before `from`, skipping escaped characters. */
function inlineMathEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") { i += 1; continue; }
    if (text[i] === "$") return i + 1;
  }
  return text.length;
}

/** Replaces verbatim environments and \verb arguments by spaces (keeping newlines), so offsets stay put. */
function maskVerbatim(tex: string): string {
  const commentFree = removeComments(tex);
  const ranges: Array<[number, number]> = [];
  let covered = 0;
  for (const match of tex.matchAll(VERBATIM)) {
    const from = match.index;
    if (from < covered || commentFree[from] !== "\\") continue;
    const [whole, env, delimiter] = match;
    const after = from + whole.length;
    let to: number;
    if (env !== undefined) {
      const closing = `\\end{${env}}`;
      const close = tex.indexOf(closing, after);
      to = close < 0 ? tex.length : close + closing.length;
    } else {
      const close = tex.indexOf(delimiter ?? "", after);
      const lineEnd = tex.indexOf("\n", after);
      to = close < 0 || (lineEnd >= 0 && lineEnd < close) ? after : close + 1;
    }
    ranges.push([from, to]);
    covered = to;
  }
  if (ranges.length === 0) return tex;
  let out = "";
  let last = 0;
  for (const [from, to] of ranges) {
    out += tex.slice(last, from) + tex.slice(from, to).replace(/[^\n]/g, " ");
    last = to;
  }
  return out + tex.slice(last);
}
