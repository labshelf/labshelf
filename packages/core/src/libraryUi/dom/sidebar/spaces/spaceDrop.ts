// Accepts validated Library paper references dropped onto Spaces or their folders.
import type { SidebarSpaceActions } from "./spaceActions.js";
import { PAPER_DRAG_MIME, parsePaperDragIds } from "../../drag/index.js";

export function acceptSpaceDrop(row: HTMLElement, actions: SidebarSpaceActions, id: string, folder?: string): void {
  const accepts = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes(PAPER_DRAG_MIME);
  row.addEventListener("dragover", (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    row.classList.add("drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
  row.addEventListener("drop", (event) => {
    row.classList.remove("drop-target");
    if (!accepts(event)) return;
    event.preventDefault();
    const ids = parsePaperDragIds(event.dataTransfer?.getData(PAPER_DRAG_MIME) ?? "[]");
    if (ids.length) actions.dropPapers(id, folder, ids);
  });
}
