// Writes bullet and ordered lists, indenting each item's later lines under its marker.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";

/** Serializes one block inside an item to lines ended with "\n". */
type BlockText = (node: Node) => string;

function itemContent(item: Node, blockText: BlockText): string {
  let content = "";
  item.forEach((child, _offset, index) => {
    const gap = child.attrs.gap as string | null;
    const isList = child.type.name === "bullet_list" || child.type.name === "ordered_list";
    content += (gap ?? (index === 0 || isList ? "" : "\n")) + blockText(child);
  });
  return content;
}

function canonicalPrefix(list: Node, index: number): string {
  if (list.type.name === "ordered_list") { return `${(list.attrs.order as number) + index}${list.attrs.delimiter as string} `; }
  return `${list.attrs.marker as string} `;
}

function serializeItem(item: Node, list: Node, index: number, blockText: BlockText): string {
  const prefix = (item.attrs.prefix as string | null) ?? canonicalPrefix(list, index);
  let head = prefix;
  if (item.type.name === "task_item") {
    const mark = item.attrs.checked ? (item.attrs.mark as string) : " ";
    head += `[${mark}]${(item.attrs.space as string | null) ?? " "}`;
  }
  const lines = itemContent(item, blockText).split("\n");
  lines.pop();
  const indent = " ".repeat(prefix.length);
  const [first = "", ...rest] = lines;
  return [head + first, ...rest.map((line) => (line ? indent + line : line))].join("\n") + "\n";
}

/** Returns the list's lines joined and ended with "\n"; item gaps use "\n". */
export function serializeList(list: Node, blockText: BlockText): string {
  let text = "";
  list.forEach((item, _offset, index) => {
    text += ((item.attrs.gap as string | null) ?? "") + serializeItem(item, list, index, blockText);
  });
  return text;
}
