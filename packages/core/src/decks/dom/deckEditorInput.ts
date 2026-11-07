// The deck editor's input: pointer presses, drags and resizes of blocks, the hand tool's pan, keys, and the stage resizes that redraw it.
import { gestureEdit, gestureRect, nudgeEdit, selectBlock } from "../deckGestures.js";
import type { ResizeHandle } from "../deckSnap.js";
import type { DeckRect } from "../deckParse.js";
import { gestureTransform } from "./deckOverlay.js";
import {
  beginEditing, canvasOf, commitEditing, commitEdits, findBlock, isReadOnly, renderChrome, selectedBlocks, setSelection, slideBlocks,
  type Drag, type Editor,
} from "./deckEditorCore.js";

function frameBlock(ed: Editor, id: string): HTMLElement | null {
  const doc = ed.frame.frame.contentDocument;
  return Array.from(doc?.querySelectorAll<HTMLElement>("[data-block]") ?? []).find((element) => element.getAttribute("data-block") === id) ?? null;
}

function pressBox(ed: Editor, event: PointerEvent): void {
  if (event.button !== 0 || isReadOnly(ed) || ed.destroyed) return;
  const target = event.target instanceof Element ? event.target : null;
  const boxEl = target?.closest<HTMLElement>("[data-block-box]");
  if (!boxEl) {
    if (ed.selection.blocks.length > 0) setSelection(ed, selectBlock(ed.selection, null, false));
    return;
  }
  const id = boxEl.getAttribute("data-block-box")!;
  const block = findBlock(ed, id);
  if (!block?.rect) return;
  const handle = target?.closest<HTMLElement>("[data-handle]")?.getAttribute("data-handle") as ResizeHandle | null | undefined;
  event.preventDefault();
  boxEl.focus({ preventScroll: true });
  if (!handle) {
    setSelection(ed, selectBlock(ed.selection, id, event.shiftKey));
    // A Shift press on a selected box takes it out of the selection and starts no gesture.
    if (!ed.selection.blocks.includes(id)) return;
  }
  const captor = target ?? boxEl;
  if ("pointerId" in event && typeof captor.setPointerCapture === "function") try { captor.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
  const others = slideBlocks(ed).flatMap((other) => (other.id !== id && other.rect ? [other.rect] : []));
  ed.drag = { gesture: { kind: handle ? "resize" : "move", block: id, ...(handle ? { handle } : {}), start: block.rect, origin: { x: event.clientX, y: event.clientY } }, others, rect: null };
}

function setDragTransform(ed: Editor, drag: Drag, rect: DeckRect | null): void {
  ed.root.classList.toggle("is-dragging", rect !== null);
  const box = ed.overlay.box(drag.gesture.block);
  const element = frameBlock(ed, drag.gesture.block);
  const { start } = drag.gesture;
  if (box) box.style.transform = rect ? gestureTransform(start, rect, ed.scale) : "";
  if (element) element.style.transform = rect ? gestureTransform(start, rect, 1) : "";
}

function moveDrag(ed: Editor, event: PointerEvent): void {
  const drag = ed.drag;
  if (!drag) return;
  const result = gestureRect(drag.gesture, { x: event.clientX, y: event.clientY }, { scale: ed.scale, snap: { others: drag.others, canvas: canvasOf(ed), disabled: event.altKey } });
  drag.rect = result.rect;
  setDragTransform(ed, drag, result.rect);
  ed.overlay.showGuides(result.guides, ed.scale);
}

export function endDrag(ed: Editor, apply: boolean): void {
  const drag = ed.drag;
  if (!drag) return;
  ed.drag = null;
  setDragTransform(ed, drag, null);
  ed.overlay.clearGuides();
  const edit = apply && drag.rect ? gestureEdit(drag.gesture, drag.rect) : null;
  if (edit) commitEdits(ed, [edit], drag.gesture.kind === "move" ? "Move block" : "Resize block");
}
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The stage's own keys: arrows nudge the selection, Enter edits the one selected block; the shell maps the shared keys. */
function onKey(ed: Editor, event: KeyboardEvent): void {
  if (isReadOnly(ed) || ed.leaf.block() !== null || ed.drag || ed.destroyed) return;
  if (event.ctrlKey || event.metaKey) return;
  if (!(event.target instanceof Node) || !ed.stage.contains(event.target)) return;
  const arrow = ARROWS[event.key];
  const selected = selectedBlocks(ed);
  if (arrow) {
    if (selected.length === 0) return;
    const distance = event.shiftKey ? 10 : 1;
    event.preventDefault();
    commitEdits(ed, selected.map((block) => nudgeEdit(block.id, block.rect, arrow[0] * distance, arrow[1] * distance)), "Move block");
  } else if (event.key === "Enter") {
    if (ed.selection.blocks.length !== 1) return;
    event.preventDefault();
    beginEditing(ed, ed.selection.blocks[0]!, null);
  }
}

/** Wires the frame, stage, keys and stage resizes to the editor; returns the resize observer to disconnect on destroy. */
export function bindEditorEvents(ed: Editor): ResizeObserver | null {
  const { frame, root, stage } = ed;
  frame.frame.addEventListener("load", () => { const doc = frame.frame.contentDocument; if (doc) ed.leaf.attach(doc); });
  root.addEventListener("pointerdown", (event) => { if (!ed.leaf.contains(event.target instanceof Node ? event.target : null)) commitEditing(ed); }, true);
  stage.addEventListener("pointerdown", (event) => pressBox(ed, event));
  stage.addEventListener("pointermove", (event) => moveDrag(ed, event));
  stage.addEventListener("pointerup", () => endDrag(ed, true));
  stage.addEventListener("pointercancel", () => endDrag(ed, false));
  const boxId = (target: EventTarget | null): string | null | undefined => (target instanceof Element ? target.closest("[data-block-box]")?.getAttribute("data-block-box") : null);
  stage.addEventListener("dblclick", (event) => { const id = boxId(event.target); if (id) beginEditing(ed, id, null); });
  root.addEventListener("keydown", (event) => onKey(ed, event));
  bindPan(ed);
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!ed.drag) renderChrome(ed); }) : null;
  resize?.observe(ed.viewport);
  return resize;
}


/** With the hand tool a press on the stage pans the viewport; Mod+wheel zooms. */
function bindPan(ed: Editor): void {
  const { viewport } = ed;
  viewport.addEventListener("pointerdown", (event) => {
    if (ed.tool !== "hand" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    const move = (e: PointerEvent): void => { viewport.scrollLeft = start.left - (e.clientX - start.x); viewport.scrollTop = start.top - (e.clientY - start.y); };
    const up = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, true);
  viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    ed.zoom = Math.min(4, Math.max(0.05, ed.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    renderChrome(ed);
  }, { passive: false });
}
