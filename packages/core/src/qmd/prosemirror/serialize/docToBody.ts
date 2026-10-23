// Writes a LabShelf Markdown document back to an item body.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { serializeBlock } from "./serializeBlocks.js";

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
