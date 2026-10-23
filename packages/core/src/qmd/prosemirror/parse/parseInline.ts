// Reads the inline Markdown of one paragraph or heading into ProseMirror nodes.
// CONTRACT: documents/contracts/qmd-items.md#format
import { Fragment, type Node } from "prosemirror-model";
import { serializeInline } from "../serialize/index.js";
import { plainInline, readInlineRange } from "./inline/index.js";

/** `text` is the paragraph's source lines joined with "\n", without a final newline. */
export function parseInline(text: string): Node[] {
  // Fragment.from joins adjacent text nodes that carry the same marks.
  const read = Fragment.from(readInlineRange(text, 0, text.length));
  // INVARIANT: serializeInline(parseInline(text)) === text; a reading that would rewrite bytes falls back to literal text.
  if (serializeInline(read) !== text) return plainInline(text);
  const nodes: Node[] = [];
  read.forEach((node) => nodes.push(node));
  return nodes;
}
