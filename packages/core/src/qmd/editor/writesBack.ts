// Applies marks to read nodes and checks they write back as their exact source.
// CONTRACT: documents/contracts/qmd-items.md#format
import { Fragment, type Mark, type Node } from "prosemirror-model";
import { serializeInline } from "./serializeInline.js";

export function withMark(nodes: readonly Node[], mark: Mark): Node[] {
  return nodes.map((node) => node.mark(mark.addToSet(node.marks)));
}

/** True when the nodes write back as exactly `source`; constructs that would not stay literal text. */
export function writesBackAs(nodes: readonly Node[], source: string): boolean {
  return serializeInline(Fragment.from(nodes)) === source;
}
