/** Plans a section preview: which recorded section an edit is in, the definitions it needs from before it, the filtered aux, and the section document that typesets it alone. */
import { type LatexPosition, type LatexSourceFacts, type SectionFact, removeComments, scanLatexSource } from "./source.js";
import { findSpaceEnd, lineStartsOf, readDelimited } from "./sourceCommands.js";
import { resolveIncludePath } from "./sourceProject.js";
import { createSectionBuildStateRestore, type SectionState } from "./sectionState.js";

interface SourceSpan {
  start: number;
  end: number;
}

// Argument shapes: `*` an optional star, `{` a group or a single token, `[` an optional bracket group.
const SHAPES: ReadonlyMap<string, string> = new Map([
  ["theoremstyle", "{"], ["newtheorem", "*{[{["], ["newenvironment", "*{[[{{"], ["newcounter", "{["], ["newlength", "{"],
]);
const DEFS: ReadonlySet<string> = new Set(["def", "gdef", "edef", "xdef"]);
const COMMAND = /\\([A-Za-z]+)/g;
const TOKEN = /\\(?:[A-Za-z@]+|.)/y;

function readToken(text: string, at: number): number | undefined {
  if (at >= text.length) { return undefined; }
  if (text[at] !== "\\") { return at + 1; }
  TOKEN.lastIndex = at;
  return TOKEN.exec(text) ? TOKEN.lastIndex : undefined;
}

function readShape(text: string, after: number, shape: string): number | undefined {
  let at: number | undefined = after;
  for (const part of shape) {
    if (part === "*") { if (text[at] === "*") { at++; } continue; }
    const from = findSpaceEnd(text, at);
    if (part === "[") { at = readDelimited(text, from, "[")?.next ?? at; continue; }
    at = text[from] === "{" ? readDelimited(text, from, "{")?.next : readToken(text, from);
    if (at === undefined) { return undefined; }
  }
  return at;
}

/** `\def\name<parameter text>{body}`: the parameter text runs to the first unescaped brace. */
function readDef(text: string, after: number): number | undefined {
  const name = findSpaceEnd(text, after);
  let at = text[name] === "\\" ? readToken(text, name) : undefined;
  if (at === undefined) { return undefined; }
  while (at < text.length && text[at] !== "{") { at += text[at] === "\\" ? 2 : 1; }
  return readDelimited(text, at, "{")?.next;
}

/** `\let\name=\other`, with the equals sign and the space around it optional. */
function readLet(text: string, after: number): number | undefined {
  const name = findSpaceEnd(text, after);
  const named = text[name] === "\\" ? readToken(text, name) : undefined;
  if (named === undefined) { return undefined; }
  let at = findSpaceEnd(text, named);
  if (text[at] === "=") { at = findSpaceEnd(text, at + 1); }
  return readToken(text, at);
}

/** Expects comment-free text; spans may nest, e.g. a `\def` inside a `\newenvironment` body. */
function findDefinitionSpans(text: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (const match of text.matchAll(COMMAND)) {
    const command = match[1]!;
    const after = match.index + match[0].length;
    const shape = SHAPES.get(command);
    const end = DEFS.has(command) ? readDef(text, after)
      : command === "let" ? readLet(text, after)
      : shape ? readShape(text, after, shape) : undefined;
    if (end !== undefined) { spans.push({ start: match.index, end }); }
  }
  return spans;
}

const BEGIN_DOCUMENT = /\\begin\s*\{document\}/;

function offsetsOf(text: string): (position: LatexPosition) => number {
  const lineStarts = lineStartsOf(text);
  return (position) => lineStarts[position.line]! + position.character;
}

/**
 * `scan` is `scanLatexSource(text)`. Definitions before `\begin{document}` are skipped: the format holds the preamble,
 * and a second `\newcommand` of the same name stops TeX. A definition nested in another is kept once, inside its parent.
 */
export function extractDefinitions(text: string, scan: LatexSourceFacts): string[] {
  // INVARIANT: removeComments keeps offsets, so spans found in the stripped text slice the original.
  const stripped = removeComments(text);
  const body = BEGIN_DOCUMENT.exec(stripped);
  const from = body ? body.index + body[0].length : 0;
  const offset = offsetsOf(text);
  const spans: SourceSpan[] = [
    ...scan.macros.map((macro) => ({ start: offset(macro.range.start), end: offset(macro.range.end) })),
    ...findDefinitionSpans(stripped),
  ].filter((span) => span.start >= from).sort((a, b) => a.start - b.start);
  const definitions: string[] = [];
  let covered = -1;
  for (const span of spans) {
    if (span.start < covered) { continue; }
    definitions.push(text.slice(span.start, span.end));
    covered = span.end;
  }
  return definitions;
}

export interface SectionDocumentInput {
  /** The format dumped from the main file's preamble, without extension. */
  formatName: string;
  definitions: readonly string[];
  state: SectionState;
  sectionText: string;
}

export interface SectionDocument {
  text: string;
  /** Lines before the section text: a problem on document line L is on source line L − headerLines + the section's start line. */
  headerLines: number;
}

// INVARIANT: the job's own aux holds the full build's filtered aux; `\begin{document}` reads it while preamble-only
// commands such as `\newlabel` still work, and before the restore, whose values its `\@setckpt` lines would overwrite.
// The definitions come before the restore too, because `\newcounter` and `\newtheorem` reset counters.
export function createSectionDocument(input: SectionDocumentInput): SectionDocument {
  const header = `%&${input.formatName}\n\\begin{document}\n`
    + input.definitions.map((definition) => `${definition}\n`).join("")
    + createSectionBuildStateRestore(input.state);
  return { text: `${header}${input.sectionText}\n\\end{document}\n`, headerLines: header.split("\n").length - 1 };
}

export interface MacrosBeforeSectionInput {
  /** Project-root-relative path to text. */
  sources: Readonly<Record<string, string>>;
  main: string;
  editedFile: string;
  /** Zero-based line of the section's first line in `editedFile`. */
  startLine: number;
}

function includeTarget(path: string, sources: Readonly<Record<string, string>>): string | undefined {
  const target = resolveIncludePath(path);
  return target !== undefined && target in sources ? target : undefined;
}

function piece(lines: readonly string[], from: number, to: number): string {
  return lines.slice(from, to).join("\n");
}

/** Walks one file; returns true once the edited file's stop line is reached. */
function walk(file: string, input: MacrosBeforeSectionInput, out: string[], active: Set<string>): boolean {
  const text = input.sources[file]!;
  const lines = text.split("\n");
  const isEdited = file === input.editedFile;
  const end = isEdited ? Math.min(input.startLine, lines.length) : lines.length;
  const begin = file === input.main ? lines.findIndex((line) => BEGIN_DOCUMENT.test(line)) + 1 : 0;
  const includes = scanLatexSource(text).includes
    .filter((include) => include.range.start.line >= begin && include.range.start.line < end)
    .sort((a, b) => a.range.start.line - b.range.start.line);
  let cursor = begin;
  const flush = (to: number): void => {
    const body = piece(lines, cursor, to);
    out.push(...extractDefinitions(body, scanLatexSource(body)));
  };
  for (const include of includes) {
    const target = includeTarget(include.path, input.sources);
    if (target === undefined || active.has(target) || include.range.start.line < cursor) { continue; }
    flush(include.range.start.line);
    cursor = include.range.end.line + 1;
    active.add(target);
    const reached = walk(target, input, out, active);
    active.delete(target);
    if (reached) { return true; }
  }
  flush(Math.max(end, cursor));
  return isEdited;
}

export function extractDefinitionsBeforeSection(input: MacrosBeforeSectionInput): string[] {
  if (!(input.main in input.sources)) { return []; }
  const out: string[] = [];
  walk(input.main, input, out, new Set([input.main]));
  return out;
}

function sourcePathKey(path: string): string {
  return path.trim().replace(/^(\.\/)+/, "").replace(/\.tex$/, "");
}

function sourcesByKey(sources: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(sources).map(([path, text]) => [sourcePathKey(path), text]));
}

type SectionTextFallback = "include" | "input-unreadable" | "input-with-definitions" | "afterpage" | "unclosed-float";

const INPUT = /\\input(?![A-Za-z@])/g;
const AFTERPAGE = /\\afterpage(?![A-Za-z@])/;
const FLOAT = /\\(begin|end)\s*\{((?:figure|table)\*?)\}/g;

/** A float opened in this section and closed in the next one would be cut in half. */
function hasUnclosedFloat(text: string): boolean {
  const open = new Map<string, number>();
  for (const [, side, name] of text.matchAll(FLOAT)) {
    open.set(name!, (open.get(name!) ?? 0) + (side === "begin" ? 1 : -1));
  }
  return [...open.values()].some((count) => count > 0);
}

/** An `\input` file that defines macros would define them before the section in the full build but after the restore here. */
function inputFallback(text: string, stripped: string, sources: ReadonlyMap<string, string>): SectionTextFallback | undefined {
  const inputs = scanLatexSource(text).includes.filter((include) => include.command === "input");
  // TRAP: the scanner reads only braced paths, so `\input chap` is counted here but never resolved.
  if (inputs.length < [...stripped.matchAll(INPUT)].length) { return "input-unreadable"; }
  for (const input of inputs) {
    const source = sources.get(sourcePathKey(input.path));
    if (source === undefined) { return "input-unreadable"; }
    if (extractDefinitions(source, scanLatexSource(source)).length > 0) { return "input-with-definitions"; }
  }
  return undefined;
}

function sectionTextFallback(text: string, sources: ReadonlyMap<string, string>): SectionTextFallback | undefined {
  const stripped = removeComments(text);
  if (scanLatexSource(text).includes.some((include) => include.command === "include")) { return "include"; }
  if (AFTERPAGE.test(stripped)) { return "afterpage"; }
  if (hasUnclosedFloat(stripped)) { return "unclosed-float"; }
  return inputFallback(text, stripped, sources);
}

export interface SectionPreviewInput {
  /** As TeX names it, relative to the main file's folder. */
  editedFile: string;
  /** 0-based. */
  editedLine: number;
  /** Path relative to the main file's folder → text, for the main file and every file it inputs. */
  sources: Readonly<Record<string, string>>;
  /** From the last full build's state file. */
  states: readonly SectionState[];
  hasAux: boolean;
  engine: string;
  /** Whether the main file's preamble is dumped as a format. */
  hasFormat: boolean;
}

type SectionFallbackReason =
  | "shared-page" | "no-full-build" | "engine" | "no-format" | "outside-section" | "no-matching-state" | SectionTextFallback;

export type SectionPreviewPlan =
  /** Lines are 0-based in `file`, `endLine` exclusive; `file` is the state's name for it. */
  | { kind: "section"; sectionIndex: number; startLine: number; endLine: number; file: string }
  | { kind: "fallback"; reason: SectionFallbackReason };

/** The levels the state package records: part through subsubsection. */
const DEEPEST_RECORDED_LEVEL = 3;
const END_DOCUMENT = /\\end\s*\{document\}/;

function buildFallback(input: SectionPreviewInput): SectionFallbackReason | undefined {
  if (input.states.length === 0 || !input.hasAux) { return "no-full-build"; }
  if (input.engine !== "pdflatex") { return "engine"; }
  return input.hasFormat ? undefined : "no-format";
}

/** The section ends at the next recorded heading, at `\end{document}`, or at an `\input` whose file holds the next heading. */
function sectionEndLine(text: string, scan: LatexSourceFacts, next: SectionFact | undefined, startLine: number,
  sources: ReadonlyMap<string, string>): number {
  const stripped = removeComments(text);
  const end = END_DOCUMENT.exec(stripped);
  const ends = [
    next ? next.range.start.line : text.split("\n").length,
    end ? stripped.slice(0, end.index).split("\n").length - 1 : Infinity,
    ...scan.includes
      .filter((include) => include.command === "input" && include.range.start.line > startLine)
      .filter((include) => scanLatexSource(sources.get(sourcePathKey(include.path)) ?? "").sections.length > 0)
      .map((include) => include.range.start.line),
  ];
  return Math.min(...ends);
}

// INVARIANT: headings match records by file and line, never by position: `\tableofcontents` and other kernel code
// issue starred headings that are recorded but have no heading in the source.
export function createSectionPreviewPlan(input: SectionPreviewInput): SectionPreviewPlan {
  const fallback = (reason: SectionFallbackReason): SectionPreviewPlan => ({ kind: "fallback", reason });
  const blocked = buildFallback(input);
  if (blocked) { return fallback(blocked); }
  const sources = sourcesByKey(input.sources);
  const file = sourcePathKey(input.editedFile);
  const text = sources.get(file);
  if (text === undefined) { return fallback("outside-section"); }
  const scan = scanLatexSource(text);
  const headings = scan.sections.filter((section) => section.level <= DEEPEST_RECORDED_LEVEL);
  // INVARIANT: the scan lists headings in source order.
  const at = headings.filter((heading) => heading.range.start.line <= input.editedLine).length - 1;
  if (at < 0) { return fallback("outside-section"); }
  const startLine = headings[at]!.range.start.line;
  const sectionIndex = input.states.findIndex((state) => sourcePathKey(state.file) === file && state.line === startLine + 1);
  if (sectionIndex < 0) { return fallback("no-matching-state"); }
  const next = input.states[sectionIndex + 1];
  if (!input.states[sectionIndex]!.pageBoundary || (next && !next.pageBoundary)) return fallback("shared-page");
  const endLine = sectionEndLine(text, scan, headings[at + 1], startLine, sources);
  if (input.editedLine >= endLine) { return fallback("outside-section"); }
  const reason = sectionTextFallback(text.split("\n").slice(startLine, endLine).join("\n"), sources);
  if (reason) { return fallback(reason); }
  return { kind: "section", sectionIndex, startLine, endLine, file: input.states[sectionIndex]!.file };
}

// TRAP: these lines would write the section's partial toc, lof and lot over the full ones, or repeat bibliography setup.
const DROPPED = /^\\(?:@writefile|contentsline|bibstyle|bibdata)(?![A-Za-z@])/;

// INVARIANT: TeX never wraps `\write` lines in a file, so every aux entry is one line.
export function deriveSectionAux(auxText: string): string {
  return auxText.split("\n").filter((line) => !DROPPED.test(line)).join("\n");
}

export interface PageRange {
  /** 0-based index of the first page. */
  start: number;
  /** 0-based index of the last page, inclusive. */
  end: number;
}

// INVARIANT: an empty boundary page belongs to the next section; a partially filled page includes this section's tail.
export function deriveSectionPageRange(states: readonly SectionState[], sectionIndex: number, fullPageCount: number): PageRange {
  const state = states[sectionIndex];
  if (!state) { throw new Error(`sectionPageRange: no section state ${sectionIndex} of ${states.length}`); }
  const last = fullPageCount - 1;
  const next = states[sectionIndex + 1];
  const end = Math.min(next ? (next.pageBoundary ? next.absolutePage - 2 : next.fillingPage - 1) : last, last);
  return { start: Math.min(state.absolutePage - 1, end), end };
}
