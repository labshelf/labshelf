// Writes one block of a LabShelf Markdown document back to its source text.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { serializeInline } from "./serializeInline.js";

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
function serializeList(list: Node, blockText: BlockText): string {
  let text = "";
  list.forEach((item, _offset, index) => {
    text += ((item.attrs.gap as string | null) ?? "") + serializeItem(item, list, index, blockText);
  });
  return text;
}

function longestClosingRun(lines: string, fence: string): number {
  const char = fence[0] ?? "`";
  let longest = 0;
  for (const line of lines.split("\n")) {
    const run = /^(\S+) *$/.exec(line)?.[1];
    if (run && run.length >= fence.length && [...run].every((c) => c === char)) { longest = Math.max(longest, run.length); }
  }
  return longest;
}

/** Returns the cell's lines joined and ended with "\n". */
function serializeCodeCell(node: Node): string {
  const { lang, options, code, fence, info, close } = node.attrs as {
    lang: string | null; options: string; code: string; fence: string; info: string | null; close: string | null;
  };
  const run = longestClosingRun(options + code, fence);
  const langInfo = lang ? `{${lang}}` : "";
  if (run > 0) {
    const longer = (fence[0] ?? "`").repeat(run + 1);
    return `${longer}${langInfo}\n${options}${code}${longer}\n`;
  }
  return `${fence}${info ?? langInfo}\n${options}${code}${close ?? fence}\n`;
}

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
