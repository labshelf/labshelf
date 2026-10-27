// Carries paper references between Library folder and Space drop targets: the drag payload with its validation, the drag start and stop, and the drop zone.
import type { UiContext } from "./uiContext.js";

export const PAPER_DRAG_MIME = "application/x-labshelf-papers";
const DRAGGING_CLASS = "dragging-papers";

/** Whether the drag carries papers (the paper-id MIME type is among its types). */
export function acceptsPaperDrop(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(PAPER_DRAG_MIME);
}

export function attachDropZone(ctx: Pick<UiContext, "transport">, el: HTMLElement, folder: string): void {
  el.addEventListener("dragover", (e) => {
    if (!acceptsPaperDrop(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    el.classList.remove("drop-target");
    if (!acceptsPaperDrop(e)) return;
    e.preventDefault();
    const ids = parsePaperDragPayload(e.dataTransfer?.getData(PAPER_DRAG_MIME) ?? "[]");
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

export function stopPaperDrag(ctx: UiContext): void {
  ctx.root.classList.remove(DRAGGING_CLASS);
}

/** The paper ids in a drag payload; anything that is not a list of non-empty strings gives none. */
export function parsePaperDragPayload(payload: string): string[] {
  try {
    const ids: unknown = JSON.parse(payload);
    return Array.isArray(ids) && ids.every(id => typeof id === "string" && id.trim()) ? ids : [];
  } catch {
    return [];
  }
}
