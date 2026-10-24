// Reads citations, links and images that start with `[` or `![`.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "./schema/index.js";
import { matchCitation } from "./schema/index.js";
import { withMark, writesBackAs } from "./writesBack.js";

export type ReadRange = (from: number, end: number) => Node[];

function closingBracket(source: string, at: number, end: number): number {
  let depth = 0;
  for (let index = at; index < end; index++) {
    const char = source[index];
    if (char === "\\") index++;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return index;
  }
  return -1;
}

/** Reads `(destination)` at `at`; whitespace means title syntax or spaces, which do not round trip. */
function destination(source: string, at: number, end: number): { href: string; end: number } | null {
  if (source[at] !== "(") return null;
  let depth = 0;
  for (let index = at + 1; index < end; index++) {
    const char = source[index] ?? "";
    if (/\s/.test(char)) return null;
    if (char === "\\") index++;
    else if (char === "(") depth++;
    else if (char === ")" && depth-- === 0) return { href: source.slice(at + 1, index), end: index + 1 };
  }
  return null;
}

export function readBracketed(source: string, at: number, end: number, readRange: ReadRange): { nodes: Node[]; end: number } | null {
  const image = source[at] === "!";
  const open = image ? at + 1 : at;
  if (!image) {
    const citation = matchCitation(source.slice(at, end));
    if (citation) {
      const raw = source.slice(at, at + citation.length);
      return { nodes: [qmdSchema.node("citation", { keys: citation.keys, raw })], end: at + citation.length };
    }
  }
  const close = closingBracket(source, open, end);
  const target = close < 0 ? null : destination(source, close + 1, end);
  if (!target) return null;
  const nodes = image
    ? [qmdSchema.node("image", { alt: source.slice(open + 1, close), src: target.href })]
    : withMark(readRange(open + 1, close), qmdSchema.mark("link", { href: target.href }));
  if (nodes.length === 0 || !writesBackAs(nodes, source.slice(at, target.end))) return null;
  return { nodes, end: target.end };
}
