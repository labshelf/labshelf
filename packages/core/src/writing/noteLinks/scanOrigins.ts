/** Finds the equations a manuscript took from notes, by their origin comments, and reads back the text each hash covers. */
import type { LatexRange } from "../../latex/index.js";
import { findOriginCommentStart } from "./originComment.js";
import { parseOriginComment } from "./originSyntax.js";

export interface ManuscriptOrigin { line: number; notePath: string; label: string; hash: string; insertedRange: LatexRange }

type Language = "latex" | "typst";

const BEGIN_EQUATION = "\\begin{equation}";

export function scanOrigins(language: Language, text: string): ManuscriptOrigin[] {
  const lines = text.split("\n");
  const starts = lineStarts(lines);
  const origins: ManuscriptOrigin[] = [];
  lines.forEach((raw, line) => {
    const content = raw.replace(/\r$/, "");
    const parsed = parseOriginComment(content);
    if (!parsed) { return; }
    const commentOffset = starts[line]! + findOriginCommentStart(content);
    const insertStart = findInsertStart(language, text, commentOffset) ?? starts[line]!;
    origins.push({
      line,
      ...parsed,
      insertedRange: {
        start: toPosition(starts, insertStart),
        end: { line, character: content.length },
      },
    });
  });
  return origins;
}

/** The text the origin hash covers, trimmed: between `\begin{equation}` and `\label{…}` for LaTeX, between the `$` pair for Typst. */
export function readOriginLatex(language: Language, text: string, origin: ManuscriptOrigin): string {
  const lines = text.split("\n");
  const starts = lineStarts(lines);
  const from = offsetOf(starts, origin.insertedRange.start.line, origin.insertedRange.start.character);
  const commentLine = (lines[origin.line] ?? "").replace(/\r$/, "");
  const commentStart = findOriginCommentStart(commentLine);
  const to = offsetOf(starts, origin.line, commentStart >= 0 ? commentStart : commentLine.length);
  const insert = text.slice(from, to);
  if (language === "latex") {
    if (!insert.startsWith(BEGIN_EQUATION)) { return ""; }
    const body = insert.slice(BEGIN_EQUATION.length);
    const label = body.indexOf("\\label{");
    const end = label >= 0 ? label : body.indexOf("\\end{equation}");
    return (end >= 0 ? body.slice(0, end) : body).trim();
  }
  if (!insert.startsWith("$")) { return ""; }
  const close = insert.indexOf("$", 1);
  return (close >= 0 ? insert.slice(1, close) : insert.slice(1)).trim();
}

function findInsertStart(language: Language, text: string, commentOffset: number): number | undefined {
  const before = text.slice(0, commentOffset);
  if (language === "latex") {
    const begin = before.lastIndexOf(BEGIN_EQUATION);
    return begin >= 0 ? begin : undefined;
  }
  const close = before.lastIndexOf("$");
  if (close < 0) { return undefined; }
  const open = before.lastIndexOf("$", close - 1);
  return open >= 0 ? open : undefined;
}

function lineStarts(lines: string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

function offsetOf(starts: number[], line: number, character: number): number {
  return (starts[line] ?? 0) + character;
}

function toPosition(starts: number[], offset: number): LatexRange["start"] {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1]! <= offset) { line++; }
  return { line, character: offset - starts[line]! };
}
