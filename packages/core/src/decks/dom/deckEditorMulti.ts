// The deck editor's selection gestures (A8): a press selecting a block with its group, the drag or resize of the whole selection with its
// live transform and its edits on release (a cell on grid lines for one block), and the marquee drawn from a press on the stage background.
import type { DeckEdit } from "../deckEdit.js";
import { selectBlock } from "../deckGestures.js";
import { deckCellFits, deckGridFromTheme, defaultDeckGrid } from "../deckGrid.js";
import { expandGroups, groupEdits, groupGesture, groupRect, marqueeBlocks } from "../deckGroupGesture.js";
import type { DeckRect } from "../deckParse.js";
import type { DeckSnapResult, ResizeHandle } from "../deckSnap.js";
import { gestureTransform } from "./deckOverlay.js";
import { canvasOf, commitEdits, selectedBlocks, setSelection, slideBlocks, type Drag, type Editor } from "./deckEditorCore.js";

/** A press under 3 screen px is a click, not a marquee. */
const MARQUEE_MIN_PX = 3;

function frameBlock(ed: Editor, id: string): HTMLElement | null {
  const doc = ed.frame.frame.contentDocument;
  return Array.from(doc?.querySelectorAll<HTMLElement>("[data-block]") ?? []).find((element) => element.getAttribute("data-block") === id) ?? null;
}

/** Selects the pressed block with its group: Shift toggles the whole group, a plain press on a selected block keeps the selection. */
export function pressSelect(ed: Editor, id: string, shift: boolean): void {
  const group = expandGroups(slideBlocks(ed), [id]);
  const current = ed.selection.blocks;
  if (!shift) {
    if (current.includes(id)) return;
    return setSelection(ed, { slide: ed.selection.slide, blocks: group });
  }
  const toggled = group.reduce((selection, member) => {
    const has = selection.blocks.includes(member);
    return has === current.includes(id) ? selectBlock(selection, member, true) : selection;
  }, ed.selection);
  setSelection(ed, toggled);
}

/** Starts a move, or a resize by `handle`, of every selected block that has a rect. */
export function beginDrag(ed: Editor, origin: { x: number; y: number }, handle: ResizeHandle | null): void {
  const members = selectedBlocks(ed).map((block) => ({ id: block.id, rect: block.rect }));
  if (members.length === 0) return;
  const ids = new Set(members.map((member) => member.id));
  const others = slideBlocks(ed).flatMap((other) => (!ids.has(other.id) && other.rect ? [other.rect] : []));
  const grid = deckGridFromTheme(ed.theme, canvasOf(ed));
  ed.drag = { gesture: groupGesture(handle ? "resize" : "move", members, origin, handle ?? undefined), others, grid, result: null };
}

/** The member's rect when the union `start` becomes `target`. */
function memberRect(rect: DeckRect, start: DeckRect, target: DeckRect): DeckRect {
  const sx = start.width > 0 ? target.width / start.width : 1;
  const sy = start.height > 0 ? target.height / start.height : 1;
  return { left: target.left + (rect.left - start.left) * sx, top: target.top + (rect.top - start.top) * sy, width: rect.width * sx, height: rect.height * sy };
}

function setDragTransform(ed: Editor, drag: Drag, target: DeckRect | null): void {
  ed.root.classList.toggle("is-dragging", target !== null);
  const { start, members } = drag.gesture;
  for (const { id, rect } of members) {
    const next = target ? memberRect(rect, start, target) : null;
    const box = ed.overlay.box(id);
    const element = frameBlock(ed, id);
    if (box) box.style.transform = next ? gestureTransform(rect, next, ed.scale) : "";
    if (element) element.style.transform = next ? gestureTransform(rect, next, 1) : "";
  }
  const union = ed.overlay.selectionBox();
  if (union) union.style.transform = target ? gestureTransform(start, target, ed.scale) : "";
}

export function moveDrag(ed: Editor, event: PointerEvent): void {
  const drag = ed.drag;
  if (!drag) return;
  const result = groupRect(drag.gesture, { x: event.clientX, y: event.clientY }, { scale: ed.scale, snap: { others: drag.others, canvas: canvasOf(ed), disabled: event.altKey, grid: drag.grid } });
  drag.result = result;
  setDragTransform(ed, drag, result.rect);
  ed.overlay.showGuides(result.guides, ed.scale);
}

/** The released gesture's edits; a cell the editor's place edit would not accept (its grid is the default one) falls back to px. */
function releaseEdits(ed: Editor, drag: Drag, result: DeckSnapResult): DeckEdit[] {
  const edits = groupEdits(drag.gesture, result);
  const place = edits[0]?.kind === "place" ? edits[0] : null;
  if (!place || deckCellFits(place.cell, defaultDeckGrid(canvasOf(ed)))) return edits;
  return groupEdits(drag.gesture, { ...result, cell: null });
}

export function endDrag(ed: Editor, apply: boolean): void {
  const drag = ed.drag;
  if (!drag) return;
  ed.drag = null;
  setDragTransform(ed, drag, null);
  ed.overlay.clearGuides();
  const edits = apply && drag.result ? releaseEdits(ed, drag, drag.result) : [];
  const several = drag.gesture.members.length > 1;
  const label = drag.gesture.kind === "move" ? (several ? "Move blocks" : "Move block") : several ? "Resize blocks" : "Resize block";
  if (edits.length > 0) commitEdits(ed, edits, label);
}

/** Starts a marquee from a press on the stage background. */
export function beginMarquee(ed: Editor, event: PointerEvent): void {
  const bounds = ed.stage.getBoundingClientRect();
  ed.marquee = { origin: { x: event.clientX, y: event.clientY }, stage: { left: bounds.left, top: bounds.top }, add: event.shiftKey, rect: null };
}

export function moveMarquee(ed: Editor, event: PointerEvent): void {
  const marquee = ed.marquee;
  if (!marquee) return;
  const { origin, stage } = marquee;
  if (!marquee.rect && Math.max(Math.abs(event.clientX - origin.x), Math.abs(event.clientY - origin.y)) < MARQUEE_MIN_PX) return;
  const x = [origin.x, event.clientX].map((value) => (value - stage.left) / ed.scale);
  const y = [origin.y, event.clientY].map((value) => (value - stage.top) / ed.scale);
  marquee.rect = { left: Math.min(x[0]!, x[1]!), top: Math.min(y[0]!, y[1]!), width: Math.abs(x[1]! - x[0]!), height: Math.abs(y[1]! - y[0]!) };
  ed.overlay.showMarquee(marquee.rect, ed.scale);
}

/** Ends the marquee: the blocks under it become (or with Shift join) the selection; a click without movement clears the selection. */
export function endMarquee(ed: Editor, apply: boolean): void {
  const marquee = ed.marquee;
  if (!marquee) return;
  ed.marquee = null;
  ed.overlay.showMarquee(null, ed.scale);
  if (!apply) return;
  const { slide, blocks } = ed.selection;
  if (!marquee.rect) {
    if (blocks.length > 0) setSelection(ed, { slide, blocks: [] });
    return;
  }
  const hits = marqueeBlocks(slideBlocks(ed), marquee.rect);
  setSelection(ed, { slide, blocks: marquee.add ? [...blocks, ...hits.filter((id) => !blocks.includes(id))] : hits });
}
