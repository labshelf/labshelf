// Finds positions in a parsed SyncTeX file: where a source line appears in the output and which source line produced a point of a page.
import type { PagePoint } from "../reader/index.js";
import { isBox, normalizeInputPath, type SourcePosition, type SyncBox, type SynctexMap, type SyncNode } from "./synctexFile.js";

/** First index of `lines` (ascending) that is >= `line`. */
function firstAtLeast(lines: readonly number[], line: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((lines[middle] ?? 0) < line) { low = middle + 1; } else { high = middle; }
  }
  return low;
}

/**
 * The top-most position of the file's line on its first page. A line that produced no output maps to the next line that did,
 * or to the last one before it when none follows. `undefined` when the build did not typeset the file.
 */
export function findPagePoint(index: SynctexMap, file: string, line: number): PagePoint | undefined {
  const entry = index.byFile.get(normalizeInputPath(file, "/"));
  if (!entry || entry.lines.length === 0) { return undefined; }
  const at = firstAtLeast(entry.lines, line);
  const matched = entry.lines[at] ?? entry.lines[entry.lines.length - 1];
  const position = matched === undefined ? undefined : entry.positions.get(matched);
  return position && { page: position.page, x: position.x, y: position.y };
}

function contains(box: SyncBox, point: PagePoint): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

/** Distance from the point to the node's rectangle (a mark is a horizontal segment); 0 inside. */
function distance(node: SyncNode, point: PagePoint): number {
  const [left, right, top, bottom] = isBox(node) ? [node.left, node.right, node.top, node.bottom] : [node.x, node.right, node.y, node.y];
  return Math.hypot(Math.max(left - point.x, 0, point.x - right), Math.max(top - point.y, 0, point.y - bottom));
}

const area = (box: SyncBox): number => (box.right - box.left) * (box.bottom - box.top);

/** The deepest box that contains the point; among overlapping siblings the smallest wins. */
function deepestContaining(nodes: readonly SyncNode[], point: PagePoint): SyncBox | undefined {
  let found: SyncBox | undefined;
  for (const node of nodes) {
    if (isBox(node) && contains(node, point) && (!found || area(node) < area(found))) { found = node; }
  }
  return found && (deepestContaining(found.children, point) ?? found);
}

const leftOf = (node: SyncNode): number => (isBox(node) ? node.left : node.x);

/** Inside a text line a mark stands for the run up to the next mark, so the point belongs to the last mark at or before it. */
function runAt(nodes: readonly SyncNode[], point: PagePoint): SyncNode | undefined {
  const sorted = [...nodes].sort((a, b) => leftOf(a) - leftOf(b));
  return sorted.filter((node) => leftOf(node) <= point.x).at(-1) ?? sorted[0];
}

/** The node that stands for the point among sibling nodes: a run of a text line, or the closest line box when they are all boxes. */
function resolve(nodes: readonly SyncNode[], point: PagePoint): SyncNode | undefined {
  if (nodes.some((node) => !isBox(node))) { return runAt(nodes, point); }
  let best: SyncNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const found = distance(node, point);
    if (found < bestDistance) { best = node; bestDistance = found; }
  }
  return best && isBox(best) && best.children.length > 0 ? (resolve(best.children, point) ?? best) : best;
}

/** The source behind the output at `point`: the run under it inside the smallest box around it, else in the closest line on the page. */
export function findSourcePosition(index: SynctexMap, point: PagePoint): SourcePosition | undefined {
  const nodes = index.pages.get(point.page);
  if (!nodes) { return undefined; }
  const container = deepestContaining(nodes, point);
  const hit = container ? (resolve(container.children, point) ?? container) : resolve(nodes, point);
  const file = hit && index.files.get(hit.tag);
  return hit && file !== undefined ? { file, line: hit.line } : undefined;
}
