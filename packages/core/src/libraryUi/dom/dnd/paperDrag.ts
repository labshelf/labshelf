// Carries paper references between Library folder and Space drop targets.
import type { UiContext } from "../uiContext.js";

import { PAPER_DRAG_MIME, parsePaperDragIds } from "./paperDragData.js";
const DRAGGING_CLASS = "dragging-papers";

export function makeDropTarget(ctx: Pick<UiContext, "transport">, el: HTMLElement, folder: string): void {
  const accepts = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes(PAPER_DRAG_MIME);
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
    const ids = parsePaperDragIds(e.dataTransfer?.getData(PAPER_DRAG_MIME) ?? "[]");
    if (ids.length) ctx.transport.post({ type: "paper.move", ids, target: folder });
  });
}

export function startPaperDrag(ctx: Pick<UiContext, "root">, e: DragEvent, ids: string[], label: string): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(PAPER_DRAG_MIME, JSON.stringify(ids));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "copyMove";
  ctx.root.classList.add(DRAGGING_CLASS);
}

export function endPaperDrag(ctx: UiContext): void {
  ctx.root.classList.remove(DRAGGING_CLASS);
}
