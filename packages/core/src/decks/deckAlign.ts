// Align and distribute of HTML deck blocks (A8): each group and each ungrouped block is one unit that moves as a whole.
import type { DeckEdit } from "./deckEdit.js";
import { unionRect } from "./deckGroupGesture.js";
import type { DeckRect } from "./deckParse.js";

export type DeckAlignSide = "left" | "center" | "right" | "top" | "middle" | "bottom";

export interface DeckItem { id: string; rect: DeckRect; group?: string }

interface Unit { items: DeckItem[]; rect: DeckRect }

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** The units in order of first appearance: one per group (union rect), one per ungrouped item. */
function units(items: readonly DeckItem[]): Unit[] {
  const result: Unit[] = [];
  const byGroup = new Map<string, DeckItem[]>();
  for (const item of items) {
    if (!item.group) {
      result.push({ items: [item], rect: item.rect });
      continue;
    }
    const members = byGroup.get(item.group);
    if (members) {
      members.push(item);
      continue;
    }
    const fresh = [item];
    byGroup.set(item.group, fresh);
    result.push({ items: fresh, rect: item.rect });
  }
  return result.map((unit) => ({ items: unit.items, rect: unionRect(unit.items.map((item) => item.rect)) }));
}

/** Move edits for the items of a unit shifted by (dx, dy), only for items that change. */
function shift(unit: Unit, dx: number, dy: number, edits: DeckEdit[]): void {
  for (const { id, rect } of unit.items) {
    const left = round2(rect.left + dx);
    const top = round2(rect.top + dy);
    if (left !== rect.left || top !== rect.top) edits.push({ kind: "move", block: id, left, top });
  }
}

/** Aligns one unit to the canvas, several to the union of all units on the given side. */
export function alignDeckBlocks(items: readonly DeckItem[], side: DeckAlignSide, canvas: { width: number; height: number }): DeckEdit[] {
  const all = units(items);
  if (all.length === 0) return [];
  const frame = all.length === 1 ? { left: 0, top: 0, width: canvas.width, height: canvas.height } : unionRect(all.map((unit) => unit.rect));
  const edits: DeckEdit[] = [];
  for (const unit of all) {
    const { rect } = unit;
    let dx = 0;
    let dy = 0;
    if (side === "left") dx = frame.left - rect.left;
    else if (side === "center") dx = frame.left + (frame.width - rect.width) / 2 - rect.left;
    else if (side === "right") dx = frame.left + frame.width - rect.width - rect.left;
    else if (side === "top") dy = frame.top - rect.top;
    else if (side === "middle") dy = frame.top + (frame.height - rect.height) / 2 - rect.top;
    else dy = frame.top + frame.height - rect.height - rect.top;
    shift(unit, dx, dy, edits);
  }
  return edits;
}

/** Evens the gaps between 3 or more units on the axis; the first and last unit stay. */
export function distributeDeckBlocks(items: readonly DeckItem[], axis: "x" | "y"): DeckEdit[] {
  const all = units(items);
  if (all.length < 3) return [];
  const start = (rect: DeckRect): number => (axis === "x" ? rect.left : rect.top);
  const size = (rect: DeckRect): number => (axis === "x" ? rect.width : rect.height);
  const sorted = [...all].sort((a, b) => start(a.rect) - start(b.rect));
  const first = sorted[0]!.rect;
  const last = sorted[sorted.length - 1]!.rect;
  const used = sorted.reduce((sum, unit) => sum + size(unit.rect), 0);
  const gap = (start(last) + size(last) - start(first) - used) / (sorted.length - 1);
  const edits: DeckEdit[] = [];
  let cursor = start(first) + size(first) + gap;
  for (const unit of sorted.slice(1, -1)) {
    const delta = cursor - start(unit.rect);
    shift(unit, axis === "x" ? delta : 0, axis === "y" ? delta : 0, edits);
    cursor += size(unit.rect) + gap;
  }
  return edits;
}
