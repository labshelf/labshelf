/** Decides whether an edit can be previewed by typesetting its section alone, and which recorded section and lines that is. */
import { type LatexSourceFacts, type SectionFact, scanLatexSource, removeComments } from "../../source/index.js";
import type { SectionState } from "./index.js";
import { extractDefinitions } from "./collectMacros.js";

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
