// Reads an item body into a LabShelf Markdown document that writes back to the same bytes.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "./schema/index.js";
import { serializeBlock } from "./serializeBlocks.js";
import { splitBodyLines, extractRawText } from "./blockLines.js";
import { splitBlocks, type BodySlice } from "./parseBlocks.js";

/** INVARIANT: a block whose node does not write back to its exact source bytes is kept as a raw block. */
function exactBlock(block: BodySlice, source: string, eol: string): Node {
  try {
    const node = block.build(block.gap);
    if (serializeBlock(node, eol) === source) { return node; }
  } catch {
    // A block the schema rejects, such as a list item that does not start with a paragraph, falls through to raw.
  }
  return qmdSchema.nodes.raw_block!.createChecked({ text: source, gap: block.gap });
}

export function bodyToDoc(body: string): Node {
  const { lines, eol, unterminated } = splitBodyLines(body);
  const { blocks, trailing } = splitBlocks(lines);
  const nodes = blocks.map((block) => exactBlock(block, extractRawText(lines, block.start, block.end), eol));
  if (nodes.length === 0) {
    return qmdSchema.nodes.doc!.createChecked({ eol, trailing: body, unterminated: false }, [qmdSchema.nodes.paragraph!.createChecked()]);
  }
  return qmdSchema.nodes.doc!.createChecked({ eol, trailing, unterminated }, nodes);
}
