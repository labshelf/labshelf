// Makes a folder row draggable and a drop target for other folders and for files dragged from the OS.
import type { SidebarToHost } from "../ui/library/sidebarMessages.js";

const FOLDER_MIME = "application/x-labshelf-folder";

/** @returns a `dropTarget` callback that posts a move for folder drops and an import for file drops */
export function folderDropTarget(post: (m: SidebarToHost) => void): (row: HTMLElement, path: string) => void {
  return (row, path) => {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(FOLDER_MIME, path);
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; }
    });
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      const source = e.dataTransfer?.getData(FOLDER_MIME);
      if (source) {
        if (source !== path) { post({ type: "moveFolder", path: source, target: path }); }
        return;
      }
      // PLATFORM: VS Code delivers OS file drops to webviews only while Shift is held.
      const uris = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("application/vnd.code.uri-list");
      if (uris) { post({ type: "import", path, uris }); }
    });
  };
}
