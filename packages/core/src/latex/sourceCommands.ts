/** Reads individual LaTeX commands for the source scanner: argument groups, labels, references, headings, macros and includes, and the line starts that map offsets to positions. */
import type { LabelFact, LatexInclude, LatexPosition, LatexRange, MacroFact, ReferenceFact, SectionFact } from "./source.js";

export interface Delimited {
  /** Offset of the first content character. */
  start: number;
  /** Offset just past the last content character. */
  end: number;
  /** Offset just past the closing delimiter. */
  next: number;
}

/** Reads the group opened by `{` or `[` at `at`; undefined when `at` is not that opener or the group never closes. */
export function readDelimited(text: string, at: number, open: "{" | "["): Delimited | undefined {
  if (text[at] !== open) { return undefined; }
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (char === "{") { depth++; }
    else if (char === "}") {
      depth--;
      if (open === "{" && depth === 0) { return { start: at + 1, end: i, next: i + 1 }; }
    } else if (char === "]" && open === "[" && depth === 0) {
      return { start: at + 1, end: i, next: i + 1 };
    }
  }
  return undefined;
}

export function findSpaceEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) { i++; }
  return i;
}

export interface ScanContext {
  text: string;
  range(start: number, end: number): LatexRange;
}

export function createTextScan(text: string): ScanContext {
  const lineStarts = lineStartsOf(text);
  const positionAt = (offset: number): LatexPosition => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= offset) { low = mid; } else { high = mid - 1; }
    }
    return { line: low, character: offset - lineStarts[low]! };
  };
  return { text, range: (start, end) => ({ start: positionAt(start), end: positionAt(end) }) };
}

export const INCLUDE_COMMANDS: ReadonlySet<string> = new Set(["input", "include", "subfile"]);

export function readInclude(ctx: ScanContext, command: string, after: number): LatexInclude | undefined {
  const group = readDelimited(ctx.text, findSpaceEnd(ctx.text, after), "{");
  if (!group) { return undefined; }
  const path = ctx.text.slice(group.start, group.end).trim();
  if (!path) { return undefined; }
  const start = group.start + ctx.text.slice(group.start, group.end).indexOf(path);
  return { command, path, range: ctx.range(start, start + path.length) };
}

export const MACRO_COMMANDS: ReadonlySet<string> = new Set([
  "newcommand", "renewcommand", "providecommand", "DeclareMathOperator",
]);

const NAME = /\\([A-Za-z]+)/y;

/** Reads `{\name}` or `\name` at `at`; returns the name and the offset after it. */
function readName(text: string, at: number): { name: string; next: number } | undefined {
  const braced = readDelimited(text, at, "{");
  const inner = braced ? text.slice(braced.start, braced.end).trim() : undefined;
  if (braced && inner !== undefined) {
    const match = /^\\([A-Za-z]+)$/.exec(inner);
    return match ? { name: match[1]!, next: braced.next } : undefined;
  }
  NAME.lastIndex = at;
  const bare = NAME.exec(text);
  return bare ? { name: bare[1]!, next: NAME.lastIndex } : undefined;
}

export function readMacro(ctx: ScanContext, command: string, from: number, after: number, starred: boolean): MacroFact | undefined {
  const { text } = ctx;
  const named = readName(text, findSpaceEnd(text, after));
  if (!named) { return undefined; }
  let at = findSpaceEnd(text, named.next);
  let argCount = 0;
  let defaultArg: string | undefined;
  if (command !== "DeclareMathOperator") {
    const count = readDelimited(text, at, "[");
    if (count && /^\s*[0-9]\s*$/.test(text.slice(count.start, count.end))) {
      argCount = Number(text.slice(count.start, count.end));
      at = findSpaceEnd(text, count.next);
      const fallback = readDelimited(text, at, "[");
      if (fallback) {
        defaultArg = text.slice(fallback.start, fallback.end);
        at = findSpaceEnd(text, fallback.next);
      }
    }
  }
  const body = readDelimited(text, at, "{");
  if (!body) { return undefined; }
  const raw = text.slice(body.start, body.end);
  return {
    command, name: named.name, argCount, defaultArg,
    body: command === "DeclareMathOperator" ? `\\operatorname${starred ? "*" : ""}{${raw}}` : raw,
    range: ctx.range(from, body.next),
  };
}

export const REF_COMMANDS: ReadonlySet<string> = new Set([
  "ref", "eqref", "pageref", "autoref", "nameref", "cref", "Cref", "vref", "Vref", "cpageref", "Cpageref",
]);

interface NameAt { name: string; start: number; end: number }

function namesIn(ctx: ScanContext, start: number, end: number, split: boolean): NameAt[] {
  const names: NameAt[] = [];
  let offset = start;
  for (const part of split ? ctx.text.slice(start, end).split(",") : [ctx.text.slice(start, end)]) {
    const name = part.trim();
    // Names with `#` are macro parameters inside a definition, not real labels.
    if (name && !name.includes("#")) {
      const lead = part.length - part.trimStart().length;
      names.push({ name, start: offset + lead, end: offset + lead + name.length });
    }
    offset += part.length + 1;
  }
  return names;
}

export function readLabel(ctx: ScanContext, after: number): LabelFact | undefined {
  const group = readDelimited(ctx.text, findSpaceEnd(ctx.text, after), "{");
  const [found] = group ? namesIn(ctx, group.start, group.end, false) : [];
  return found && { name: found.name, range: ctx.range(found.start, found.end) };
}

export function readReferences(ctx: ScanContext, command: string, after: number): ReferenceFact[] {
  const group = readDelimited(ctx.text, findSpaceEnd(ctx.text, after), "{");
  if (!group) { return []; }
  return namesIn(ctx, group.start, group.end, true)
    .map((found) => ({ command, name: found.name, range: ctx.range(found.start, found.end) }));
}

export const SECTION_LEVELS: ReadonlyMap<string, number> = new Map([
  ["part", -1], ["chapter", 0], ["section", 1], ["subsection", 2], ["subsubsection", 3], ["paragraph", 4], ["subparagraph", 5],
]);

export function readSection(ctx: ScanContext, command: string, from: number, after: number, starred: boolean): SectionFact | undefined {
  let at = findSpaceEnd(ctx.text, after);
  const short = readDelimited(ctx.text, at, "[");
  if (short) { at = findSpaceEnd(ctx.text, short.next); }
  const title = readDelimited(ctx.text, at, "{");
  if (!title) { return undefined; }
  return {
    command, level: SECTION_LEVELS.get(command)!, starred,
    title: ctx.text.slice(title.start, title.end).replace(/\s+/g, " ").trim(),
    range: ctx.range(from, title.next),
  };
}

/** The offset where each line starts: 0, then the index after every "\n". */
export function lineStartsOf(text: string): number[] {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") { lineStarts.push(i + 1); }
  }
  return lineStarts;
}
