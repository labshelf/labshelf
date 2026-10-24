// Drags an editor tab onto the other group; while a tab drags, an empty group shows as the place to drop it.
import type { EditorGroup } from "./editorGroups.js";
import type { EditorGroupIndex } from "./types.js";

const TAB_MIME = "application/x-labshelf-editor-tab";

/** Wires dragging for every tab of `groups`; `move` runs on a drop onto the other group. */
export function wireTabDrag(root: HTMLElement, groups: readonly EditorGroup[], move: (id: string, group: EditorGroupIndex) => void): void {
  root.addEventListener("dragstart", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab || !e.dataTransfer) return;
    e.dataTransfer.setData(TAB_MIME, tab.dataset.tabId!);
    e.dataTransfer.effectAllowed = "move";
    root.classList.add("tab-dragging");
  });
  root.addEventListener("dragend", () => {
    root.classList.remove("tab-dragging");
    groups.forEach((g) => g.el.classList.remove("drop-target"));
  });
  for (const g of groups) {
    g.el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(TAB_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      g.el.classList.add("drop-target");
    });
    g.el.addEventListener("dragleave", (e) => {
      if (!g.el.contains(e.relatedTarget as Node | null)) g.el.classList.remove("drop-target");
    });
    g.el.addEventListener("drop", (e) => {
      const id = e.dataTransfer?.getData(TAB_MIME);
      if (!id) return;
      e.preventDefault();
      g.el.classList.remove("drop-target");
      move(id, g.index);
    });
  }
}
