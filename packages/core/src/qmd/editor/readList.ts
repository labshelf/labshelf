// Reads bullet, ordered and task lists, keeping each item's marker spelling and the blank lines between items.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "./schema/index.js";
import { isBlank, type BodyBlock, type Line } from "./blockLines.js";
import { parseBlocks } from "./parseBlocks.js";

const BULLET = /^([-*+])([ \t]+)(?=\S)/;
const ORDERED = /^(\d{1,9})([.)])([ \t]+)(?=\S)/;
const TASK = /^\[([ xX])\]([ \t]+)(?=\S)/;

interface Marker { readonly prefix: string; readonly kind: string; readonly order: number; readonly bullet: boolean }

function marker(content: string): Marker | undefined {
  const bullet = BULLET.exec(content);
  if (bullet) { return { prefix: bullet[0], kind: bullet[1]!, order: 0, bullet: true }; }
  const ordered = ORDERED.exec(content);
  return ordered ? { prefix: ordered[0], kind: ordered[2]!, order: Number(ordered[1]), bullet: false } : undefined;
}

export function isListMarker(content: string): boolean {
  return marker(content) !== undefined;
}

function dedent(line: Line, width: number): Line {
  const indent = /^ */.exec(line.content)![0].length;
  const content = line.content.slice(Math.min(indent, width));
  return { content, raw: content + "\n" };
}

/** The lines of the item whose marker is on `start`, dedented under the marker, and the index after them. */
function itemLines(lines: readonly Line[], start: number, width: number): { body: Line[]; end: number } {
  const content = lines[start]!.content.slice(width);
  const body = [{ content, raw: content + "\n" }];
  const indented = (line: Line | undefined) => line !== undefined && !isBlank(line) && line.content.startsWith(" ".repeat(width));
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (indented(line)) { body.push(dedent(line, width)); end++; continue; }
    if (isBlank(line)) {
      let next = end;
      while (next < lines.length && isBlank(lines[next]!)) { next++; }
      if (!indented(lines[next])) { break; }
      while (end < next) { body.push(dedent(lines[end++]!, width)); }
      continue;
    }
    // A lazy line continues the item's text, as in Pandoc.
    if (isListMarker(line.content)) { break; }
    body.push(dedent(line, 0));
    end++;
  }
  return { body, end };
}

function buildItem(body: Line[], prefix: string, isBullet: boolean, gap: string | null): Node {
  const task = isBullet ? TASK.exec(body[0]!.content) : null;
  if (!task) { return qmdSchema.nodes.list_item!.createChecked({ prefix, gap }, parseBlocks(body)); }
  const content = body[0]!.content.slice(task[0].length);
  const rest = [{ content, raw: content + "\n" }, ...body.slice(1)];
  const checked = task[1] !== " ";
  const attrs = { checked, mark: checked ? task[1]! : "x", prefix, space: task[2]!, gap };
  return qmdSchema.nodes.task_item!.createChecked(attrs, parseBlocks(rest));
}

/** Only the same bullet character or ordered delimiter continues a list. */
export function readList(lines: readonly Line[], start: number): BodyBlock | undefined {
  const first = marker(lines[start]!.content);
  if (!first) { return undefined; }
  const items: { body: Line[]; prefix: string; gap: string | null }[] = [];
  let gap: string | null = null;
  let i = start;
  let end = start;
  for (;;) {
    const item = marker(lines[i]?.content ?? "");
    if (!item || item.kind !== first.kind) { break; }
    const read = itemLines(lines, i, item.prefix.length);
    items.push({ body: read.body, prefix: item.prefix, gap });
    end = read.end;
    i = end;
    while (i < lines.length && isBlank(lines[i]!)) { i++; }
    gap = lines.slice(end, i).map((line) => line.content + "\n").join("");
  }
  const build = (blockGap: string) => {
    const nodes = items.map((item) => buildItem(item.body, item.prefix, first.bullet, item.gap));
    return first.bullet
      ? qmdSchema.nodes.bullet_list!.createChecked({ marker: first.kind, gap: blockGap }, nodes)
      : qmdSchema.nodes.ordered_list!.createChecked({ order: first.order, delimiter: first.kind, gap: blockGap }, nodes);
  };
  return { end, build };
}
