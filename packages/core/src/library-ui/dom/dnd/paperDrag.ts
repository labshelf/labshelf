/**
 * Paper drag-and-drop: rows are drag sources, folder surfaces (crumbs, chips, a host's folder tree) are drop
 * targets that ask the host to move the dragged papers. While a drag runs, the root lights up every target.
 */
import type { UiContext } from "../uiContext.js";

const DRAG_MIME = "application/x-labshelf-papers";
const DRAGGING_CLASS = "dragging-papers";

/** Marks `el` as a place papers can be dropped to move them into `folder`. */
export function makeDropTarget(ctx: UiContext, el: HTMLElement, folder: string): void {
  const accepts = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes(DRAG_MIME);
  el.addEventListener("dragover", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    el.classList.remove("drop-target");
    if (!accepts(e)) return;
    e.preventDefault();
    let ids: string[] = [];
    try { ids = JSON.parse(e.dataTransfer?.getData(DRAG_MIME) ?? "[]") as string[]; } catch { ids = []; }
    if (ids.length) ctx.transport.post({ type: "paper.move", ids, target: folder });
  });
}

/** Starts a paper drag carrying `ids`; `label` is the plain-text fallback. */
export function startPaperDrag(ctx: UiContext, e: DragEvent, ids: string[], label: string): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "move";
  ctx.root.classList.add(DRAGGING_CLASS);
}

/** Clears the drag affordance. */
export function endPaperDrag(ctx: UiContext): void {
  ctx.root.classList.remove(DRAGGING_CLASS);
}
