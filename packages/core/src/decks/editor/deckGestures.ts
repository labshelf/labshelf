// Deck editor gestures: block selection, drag and eight-handle resize in slide px, and the DeckEdit a gesture gives on release.
import type { DeckEdit } from "../deckEdit.js";
import type { DeckRect } from "../deckParse.js";
import { snapDeckRect, type DeckSnapInput, type DeckSnapResult, type ResizeHandle } from "./deckSnap.js";

export interface DeckSelection { slide: number; blocks: readonly string[] }

/** null clears the blocks; additive toggles block; otherwise the selection becomes [block]. The slide is kept. */
export function selectBlock(selection: DeckSelection, block: string | null, additive: boolean): DeckSelection {
  if (block === null) return { slide: selection.slide, blocks: [] };
  if (!additive) return { slide: selection.slide, blocks: [block] };
  const blocks = selection.blocks.includes(block) ? selection.blocks.filter((id) => id !== block) : [...selection.blocks, block];
  return { slide: selection.slide, blocks };
}

export interface DeckGesture { kind: "move" | "resize"; block: string; handle?: ResizeHandle; start: DeckRect; origin: { x: number; y: number } }

/** The snapped rect for a pointer in screen px; a resize without a handle resizes from the se corner. */
export function gestureRect(gesture: DeckGesture, pointer: { x: number; y: number }, options: { scale: number; snap: Omit<DeckSnapInput, "rect" | "moving" | "scale"> }): DeckSnapResult {
  const dx = (pointer.x - gesture.origin.x) / options.scale;
  const dy = (pointer.y - gesture.origin.y) / options.scale;
  const { start } = gesture;
  if (gesture.kind === "move") {
    const rect = { ...start, left: start.left + dx, top: start.top + dy };
    return snapDeckRect({ ...options.snap, rect, moving: "move", scale: options.scale });
  }
  const handle = gesture.handle ?? "se";
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  if (handle.includes("w")) left += dx;
  if (handle.includes("e")) right += dx;
  if (handle.includes("n")) top += dy;
  if (handle.includes("s")) bottom += dy;
  const rect = { left, top, width: right - left, height: bottom - top };
  return snapDeckRect({ ...options.snap, rect, moving: handle, scale: options.scale });
}

/** The edit a released gesture writes, or null when the rect did not change. */
export function gestureEdit(gesture: DeckGesture, rect: DeckRect): DeckEdit | null {
  const { start, block } = gesture;
  const moved = rect.left !== start.left || rect.top !== start.top;
  if (gesture.kind === "move") return moved ? { kind: "move", block, left: rect.left, top: rect.top } : null;
  if (!moved && rect.width === start.width && rect.height === start.height) return null;
  return { kind: "resize", block, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** A keyboard nudge: a move by dx, dy slide px. */
export function nudgeEdit(block: string, rect: DeckRect, dx: number, dy: number): DeckEdit {
  return { kind: "move", block, left: rect.left + dx, top: rect.top + dy };
}
