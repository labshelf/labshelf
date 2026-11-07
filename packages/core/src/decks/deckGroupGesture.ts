// Multi-block gestures of an HTML deck (A8): one move or resize of the union of the selected blocks, the edits it gives each block, and the marquee with its group expansion.
import type { DeckEdit } from "./deckEdit.js";
import type { DeckRect } from "./deckParse.js";
import { snapDeckRect, type DeckSnapInput, type DeckSnapResult, type ResizeHandle } from "./deckSnap.js";

export interface DeckGroupGesture { kind: "move" | "resize"; handle?: ResizeHandle; members: readonly { id: string; rect: DeckRect }[]; start: DeckRect; origin: { x: number; y: number } }

const MIN_SIZE_PX = 8;

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** The smallest rect holding every rect; a zero rect for none. */
export function unionRect(rects: readonly DeckRect[]): DeckRect {
  if (rects.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  return { left, top, width: right - left, height: bottom - top };
}

export function groupGesture(kind: "move" | "resize", members: readonly { id: string; rect: DeckRect }[], origin: { x: number; y: number }, handle?: ResizeHandle): DeckGroupGesture {
  const gesture: DeckGroupGesture = { kind, members, start: unionRect(members.map((member) => member.rect)), origin };
  return handle ? { ...gesture, handle } : gesture;
}

/** One axis of a resize: moves the start or end edge by delta, keeping the size at least 8 px with the other edge fixed. */
function resizeAxis(start: number, size: number, delta: number, movesStart: boolean, movesEnd: boolean): [number, number] {
  if (movesStart) {
    const end = start + size;
    const next = Math.min(start + delta, end - MIN_SIZE_PX);
    return [next, end - next];
  }
  if (movesEnd) return [start, Math.max(size + delta, MIN_SIZE_PX)];
  return [start, size];
}

/** The union rect under the pointer, snapped like a single block (others must not hold the members). */
export function groupRect(gesture: DeckGroupGesture, pointer: { x: number; y: number }, options: { scale: number; snap: Omit<DeckSnapInput, "rect" | "moving" | "scale"> }): DeckSnapResult {
  const dx = (pointer.x - gesture.origin.x) / options.scale;
  const dy = (pointer.y - gesture.origin.y) / options.scale;
  const { start } = gesture;
  const handle = gesture.kind === "resize" ? gesture.handle : undefined;
  let rect: DeckRect;
  if (handle) {
    const [left, width] = resizeAxis(start.left, start.width, dx, handle.includes("w"), handle.includes("e"));
    const [top, height] = resizeAxis(start.top, start.height, dy, handle.includes("n"), handle.includes("s"));
    rect = { left, top, width, height };
  } else {
    rect = { ...start, left: start.left + dx, top: start.top + dy };
  }
  return snapDeckRect({ ...options.snap, rect, moving: handle ?? "move", scale: options.scale });
}

const sameRect = (a: DeckRect, b: DeckRect): boolean => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/** The edits of a released gesture: a place edit for one member on a cell, else one move or resize edit per changed member. */
export function groupEdits(gesture: DeckGroupGesture, result: DeckSnapResult): DeckEdit[] {
  const { start, members } = gesture;
  const target = result.rect;
  if (sameRect(start, target)) return [];
  if (members.length === 1) {
    const block = members[0]!.id;
    if (result.cell) return [{ kind: "place", block, cell: result.cell }];
    if (gesture.kind === "move") return [{ kind: "move", block, left: round2(target.left), top: round2(target.top) }];
    return [{ kind: "resize", block, left: round2(target.left), top: round2(target.top), width: round2(target.width), height: round2(target.height) }];
  }
  const edits: DeckEdit[] = [];
  if (gesture.kind === "move") {
    for (const { id, rect } of members) {
      const left = round2(rect.left + target.left - start.left);
      const top = round2(rect.top + target.top - start.top);
      if (left !== rect.left || top !== rect.top) edits.push({ kind: "move", block: id, left, top });
    }
    return edits;
  }
  const sx = start.width === 0 ? 1 : target.width / start.width;
  const sy = start.height === 0 ? 1 : target.height / start.height;
  for (const { id, rect } of members) {
    const next = {
      left: round2(target.left + (rect.left - start.left) * sx),
      top: round2(target.top + (rect.top - start.top) * sy),
      width: round2(rect.width * sx),
      height: round2(rect.height * sy),
    };
    if (!sameRect(rect, next)) edits.push({ kind: "resize", block: id, ...next });
  }
  return edits;
}

/** Whether two rects overlap with a positive area; touching edges do not count. */
const overlaps = (a: DeckRect, b: DeckRect): boolean =>
  Math.min(a.left + a.width, b.left + b.width) > Math.max(a.left, b.left) && Math.min(a.top + a.height, b.top + b.height) > Math.max(a.top, b.top);

/** The blocks with a rect the marquee overlaps, in input order, with every block of a hit group. */
export function marqueeBlocks(blocks: readonly { id: string; rect: DeckRect | null; group?: string }[], marquee: DeckRect): string[] {
  const hits = blocks.filter((block) => block.rect !== null && overlaps(block.rect, marquee)).map((block) => block.id);
  return expandGroups(blocks, hits);
}

/** The ids plus every block that shares a group with one of them, in blocks' order, without duplicates. */
export function expandGroups(blocks: readonly { id: string; group?: string }[], ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set(blocks.filter((block) => wanted.has(block.id) && block.group).map((block) => block.group));
  const result: string[] = [];
  for (const block of blocks) {
    if ((wanted.has(block.id) || (block.group && groups.has(block.group))) && !result.includes(block.id)) result.push(block.id);
  }
  return result;
}
