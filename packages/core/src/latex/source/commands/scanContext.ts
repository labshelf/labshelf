/** Holds the comment-free text of one scan and converts its offsets to line and column positions. */
import type { LatexPosition, LatexRange } from "../facts.js";

export interface ScanContext {
  text: string;
  range(start: number, end: number): LatexRange;
}

export function createTextScan(text: string): ScanContext {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") { lineStarts.push(i + 1); }
  }
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
