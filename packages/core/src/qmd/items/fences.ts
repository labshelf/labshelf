// Pairs the code fences of Markdown lines with the grammar Pandoc reads them by.
// CONTRACT: documents/contracts/qmd-items.md#format
import { extractLineContent } from "./lines.js";

// After the fence: nothing, an attribute block, or one word optionally followed by an attribute block.
const CODE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\{[^}\r\n]*\}|[^\s{`]+(?:[ \t]*\{[^}\r\n]*\})?)?[ \t]*$/;

/**
 * Maps the opening line of each code fence to its closing line. A fence without a closing fence is ordinary text,
 * as in Pandoc, and so are the lines that would have been inside it.
 */
export function findCodeFences(lines: readonly string[]): Map<number, number> {
  const fences = new Map<number, number>();
  for (let i = 0; i < lines.length; i++) {
    const close = codeFenceClose(lines, i);
    if (close !== undefined) {
      fences.set(i, close);
      i = close;
    }
  }
  return fences;
}

/** Lines that open a code fence but have no closing fence in `lines`. */
export function findUnclosedCodeFences(lines: readonly string[]): number[] {
  const fences = findCodeFences(lines);
  const unclosed: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const close = fences.get(i);
    if (close !== undefined) { i = close; } else if (CODE_OPEN.test(extractLineContent(lines[i]!))) { unclosed.push(i); }
  }
  return unclosed;
}

function codeFenceClose(lines: readonly string[], open: number): number | undefined {
  const opener = CODE_OPEN.exec(extractLineContent(lines[open]!));
  if (!opener) { return undefined; }
  const marker = opener[1]!;
  const closer = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
  for (let i = open + 1; i < lines.length; i++) {
    if (closer.test(extractLineContent(lines[i]!))) { return i; }
  }
  return undefined;
}
