// Builds the sidebar's context menus: folder rows, the Library heading and the My projects heading.
import { runJoinProjectDialog } from "../../../../collab/dom/index.js";
import { runImportLinkDialog, runManageLinksDialog, runShareFolderDialog } from "../../../../share/dom/index.js";
import { showMenu, type MenuEntry } from "../../../../ui/dom/index.js";
import type { SharingHost } from "../../../sharing/index.js";
import type { ProjectOffers, SidebarProjectActions } from "../sidebarProjects.js";
import type { SidebarActions } from "../sidebarView.js";

type At = { x: number; y: number };

export function showFolderMenu(at: At, actions: SidebarActions, sharing: SharingHost | undefined, path: string, open: () => void): void {
  showMenu(at, [
    { label: "Open", icon: "list", onSelect: open },
    { label: "New Subfolder…", icon: "folder-plus", onSelect: () => actions.createFolder(path) },
    "separator",
    ...(sharing?.offers().links ? [{ label: "Share as Link…", icon: "link" as const, onSelect: () => void runShareFolderDialog(sharing, path) }, "separator" as const] : []),
    { label: "Rename…", icon: "edit", hint: "F2", onSelect: () => actions.renameFolder(path) },
    { label: "Delete Folder…", icon: "trash", danger: true, onSelect: () => actions.removeFolder(path) },
  ]);
}

/** The Library heading's menu; false when the host offers no shared links. */
export function libraryHeadingMenu(e: MouseEvent, r: HTMLElement | null, sharing: SharingHost | undefined): boolean {
  if (r?.dataset["section"] !== "library" || !sharing?.offers().links) return false;
  showMenu({ x: e.clientX, y: e.clientY }, [
    { label: "Manage Shared Links…", icon: "link", onSelect: () => void runManageLinksDialog(sharing) },
    { label: "Import Shared Link…", icon: "download", onSelect: () => void runImportLinkDialog(sharing) },
  ]);
  e.preventDefault();
  return true;
}

/** The menus of a project folder and of the My projects heading; false when the row is neither. */
export function projectContextMenu(e: MouseEvent, r: HTMLElement | null, p: SidebarProjectActions, offers: ProjectOffers, sharing: SharingHost | undefined): boolean {
  const folder = r?.dataset["projectFolder"];
  const at = { x: e.clientX, y: e.clientY };
  if (folder !== undefined) {
    if (!offers.projectFolders) return false;
    showMenu(at, [
      { label: "New Subfolder…", icon: "folder-plus", onSelect: () => p.newFolder(folder) },
      "separator",
      { label: "Rename…", icon: "edit", onSelect: () => p.renameFolder(folder) },
      { label: "Delete Folder", icon: "trash", danger: true, onSelect: () => p.deleteFolder(folder) },
    ]);
  } else if (r?.dataset["group"] === "projects.list") {
    const entries: MenuEntry[] = [
      ...(offers.newBlank ? [{ label: "New Blank Project…", icon: "new-file" as const, onSelect: () => p.newBlank() }] : []),
      ...(offers.projectFolders ? [{ label: "New Folder…", icon: "new-folder" as const, onSelect: () => p.newFolder("") }] : []),
      ...(offers.addExisting ? [{ label: "Add Existing Folder…", icon: "folder-open" as const, onSelect: () => p.addExisting() }] : []),
      ...(sharing?.offers().projects ? [{ label: "Join Shared Project…", icon: "link" as const, onSelect: () => void runJoinProjectDialog(sharing) }] : []),
      ...(offers.templates ? ["separator" as const, { label: "Explore Templates", icon: "layers" as const, onSelect: () => p.browseTemplates() }] : []),
    ];
    if (entries.length === 0) return false;
    showMenu(at, entries);
  } else return false;
  e.preventDefault();
  return true;
}
