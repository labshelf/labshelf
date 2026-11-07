// The deck editor's input: pointer presses on blocks, handles and the stage background (gestures in deckEditorMulti.ts), the hand tool's pan, keys, and the stage resizes that redraw it.
import { nudgeEdit } from "../deckGestures.js";
import type { ResizeHandle } from "../deckSnap.js";
import { beginDrag, beginMarquee, endDrag, endMarquee, moveDrag, moveMarquee, pressSelect } from "./deckEditorMulti.js";
import { beginEditing, commitEditing, commitEdits, findBlock, isReadOnly, renderChrome, selectedBlocks, type Editor } from "./deckEditorCore.js";

/** A press on a block box selects it (with its group) and drags the selection; on a handle it resizes the selection; on the background it draws a marquee. */
function pressBox(ed: Editor, event: PointerEvent): void {
  if (event.button !== 0 || isReadOnly(ed) || ed.destroyed || ed.tool !== "select") return;
  const target = event.target instanceof Element ? event.target : null;
  const handleEl = target?.closest<HTMLElement>("[data-handle]");
  const boxEl = target?.closest<HTMLElement>("[data-block-box]");
  const handle = (handleEl?.getAttribute("data-handle") ?? null) as ResizeHandle | null;
  if (!boxEl && !handle) return beginMarquee(ed, event);
  if (boxEl) {
    const id = boxEl.getAttribute("data-block-box")!;
    if (!findBlock(ed, id)?.rect) return;
    boxEl.focus({ preventScroll: true });
    if (!handle) {
      pressSelect(ed, id, event.shiftKey);
      // A Shift press on a selected box takes it (and its group) out of the selection and starts no gesture.
      if (!ed.selection.blocks.includes(id)) return void event.preventDefault();
    }
  }
  event.preventDefault();
  const captor = target ?? boxEl;
  if (captor && "pointerId" in event && typeof captor.setPointerCapture === "function") try { captor.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
  beginDrag(ed, { x: event.clientX, y: event.clientY }, handle);
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
  stage.addEventListener("pointermove", (event) => { moveDrag(ed, event); moveMarquee(ed, event); });
  stage.addEventListener("pointerup", () => { endDrag(ed, true); endMarquee(ed, true); });
  stage.addEventListener("pointercancel", () => { endDrag(ed, false); endMarquee(ed, false); });
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
