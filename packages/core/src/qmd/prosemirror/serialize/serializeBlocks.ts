// Writes one block of a LabShelf Markdown document back to its source text.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { serializeCodeCell } from "./serializeCodeCell.js";
import { serializeInline } from "./serializeInline.js";
import { serializeList } from "./serializeListBlocks.js";

const VERBATIM: Record<string, string> = { output: "raw", raw_block: "text" };

function serializeHeading(node: Node): string {
  const inline = serializeInline(node.content);
  const space = node.attrs.space as string | null;
  const hashes = "#".repeat(node.attrs.level as number);
  return (inline === "" && space === null ? hashes : hashes + (space ?? " ") + inline) + "\n";
}

/** Returns the block's lines joined and ended with "\n"; verbatim blocks return their stored bytes. */
function blockText(node: Node): string {
  const verbatim = VERBATIM[node.type.name];
  if (verbatim) { return node.attrs[verbatim] as string; }
  switch (node.type.name) {
    case "paragraph": {
      const inline = serializeInline(node.content);
      return inline === "" ? "" : inline + "\n";
    }
    case "heading": return serializeHeading(node);
    case "math_display": {
      const label = node.attrs.label as string | null;
      return `$$${node.attrs.tex as string}$$${label ? ` {#${label}}` : ""}\n`;
    }
    case "code_cell": return serializeCodeCell(node);
    case "bullet_list":
    case "ordered_list": return serializeList(node, blockText);
    default: throw new RangeError(`cannot serialize block node "${node.type.name}"`);
  }
}

/** Returns one top-level block without its leading gap, every line ending with `eol`. */
export function serializeBlock(node: Node, eol: string): string {
  const text = blockText(node);
  // INVARIANT: top-level verbatim blocks already hold the source line endings.
  return node.type.name in VERBATIM || eol === "\n" ? text : text.replace(/\n/g, eol);
}
