// Splits a body into the lines the block parser reads, each with its text and the bytes it is written back as.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { isBlankLine, lineContent, lineEnding, splitLines } from "../../items/index.js";

/**
 * `content` is the line without its ending, relative to its container. `raw` is what the line is written back as:
 * the source bytes for blank lines and top-level lines, the dedented content plus `\n` for lines inside a list item.
 */
export interface Line { readonly content: string; readonly raw: string }

/** A block found at `start`: the index after its last line, and how to build its node once its gap is known. */
export interface BlockSpan { readonly end: number; readonly build: (gap: string) => Node }

export interface BodyLines { readonly lines: Line[]; readonly eol: string; readonly unterminated: boolean }

/**
 * INVARIANT: a non-blank last line without ending gets the body's ending in `raw`, so every block's `raw` ends with a
 * line ending; a blank one stays as is, because it belongs to the doc's trailing blank lines.
 */
export function bodyLines(body: string): BodyLines {
  const eol = lineEnding(body);
  const sources = splitLines(body);
  const last = sources.at(-1);
  const unterminated = last !== undefined && lineContent(last) === last && !isBlankLine(last);
  const lines = sources.map((raw) => ({ content: lineContent(raw), raw: unterminated && raw === last ? raw + eol : raw }));
  return { lines, eol, unterminated };
}

export function isBlank(line: Line): boolean {
  return isBlankLine(line.content);
}

export function rawText(lines: readonly Line[], start: number, end: number): string {
  return lines.slice(start, end).map((line) => line.raw).join("");
}
