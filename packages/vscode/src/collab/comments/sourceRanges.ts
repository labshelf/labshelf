// Converts between line positions and offsets of a source text, and picks the text a new comment thread anchors to.
import type { TextRange } from "@labshelf/core";

/** A zero-based line and character, the same in a file with CRLF and in its LF-normalized shared text. */
export interface LinePosition { line: number; character: number }

// How many lines around a SyncTeX line a PDF quote is searched in, since SyncTeX names the line a paragraph ends on.
const QUOTE_WINDOW = 3;

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) { starts.push(index + 1); }
  return starts;
}

/** The offset just before a line's break, so a CRLF line ends before its `\r`. */
function lineEnd(text: string, starts: readonly number[], line: number): number {
  const next = starts[line + 1];
  if (next === undefined) { return text.length; }
  return text[next - 2] === "\r" ? next - 2 : next - 1;
}

export function deriveOffset(text: string, { line, character }: LinePosition): number {
  const starts = lineStarts(text);
  const row = Math.min(Math.max(line, 0), starts.length - 1);
  return Math.min(starts[row]! + Math.max(character, 0), lineEnd(text, starts, row));
}

export function derivePosition(text: string, offset: number): LinePosition {
  const starts = lineStarts(text);
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1]! <= offset) { line += 1; }
  return { line, character: offset - starts[line]! };
}

/** The range without the whitespace at its edges; undefined when only whitespace is left. */
function trimmed(text: string, start: number, end: number): TextRange | undefined {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from]!)) { from += 1; }
  while (to > from && /\s/.test(text[to - 1]!)) { to -= 1; }
  return from < to ? { start: from, end: to } : undefined;
}

/**
 * The text a thread made in the editor anchors to: the selection, or its whole lines when it is empty.
 * @returns undefined when that text is only whitespace
 */
export function createEditorCommentRange(text: string, from: LinePosition, to: LinePosition): TextRange | undefined {
  const start = deriveOffset(text, from);
  const end = deriveOffset(text, to);
  if (start < end) { return trimmed(text, start, end); }
  const starts = lineStarts(text);
  return trimmed(text, starts[Math.min(from.line, starts.length - 1)]!, lineEnd(text, starts, Math.min(to.line, starts.length - 1)));
}

/**
 * The text a review note anchors to: the quote on the nearest line around `line` that holds it, else that line itself.
 * @param line counts from 1, as SyncTeX does
 * @returns undefined when the line is past the end of the text or blank
 */
export function findSourceCommentRange(text: string, line: number, quote: string): TextRange | undefined {
  const starts = lineStarts(text);
  const row = line - 1;
  if (row < 0 || row >= starts.length) { return undefined; }
  const needle = quote.trim();
  for (let distance = 0; needle && distance <= QUOTE_WINDOW; distance += 1) {
    for (const candidate of distance === 0 ? [row] : [row - distance, row + distance]) {
      if (candidate < 0 || candidate >= starts.length) { continue; }
      const found = text.slice(starts[candidate], lineEnd(text, starts, candidate)).indexOf(needle);
      if (found !== -1) { return { start: starts[candidate]! + found, end: starts[candidate]! + found + needle.length }; }
    }
  }
  return trimmed(text, starts[row]!, lineEnd(text, starts, row));
}
