// Reads an item body into a LabShelf Markdown document and writes the document back to the same bytes.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "./qmdSchema.js";
import { splitBodyLines, extractRawText, splitBlocks, serializeBlock, type BodySlice } from "./qmdBlocks.js";

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

export function docToBody(doc: Node): string {
  const { eol, trailing, unterminated } = doc.attrs as { eol: string; trailing: string; unterminated: boolean };
  let body = "";
  doc.forEach((block, _offset, index) => {
    const gap = block.attrs.gap as string | null;
    const text = serializeBlock(block, eol);
    const isEmpty = block.type.name === "paragraph" && text === "";
    body += (gap ?? (index === 0 || isEmpty ? "" : eol)) + text;
  });
  if (unterminated) { body = body.endsWith(eol) ? body.slice(0, -eol.length) : body.replace(/\r?\n$/, ""); }
  return body + trailing;
}
