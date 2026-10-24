// Routes sidebar Space row activation, tree folding and context menus to the host.
import { confirmDialog, showMenu, type MenuEntry } from "../../../../ui/dom/index.js";
import type { SidebarSpacesState } from "./spaceActions.js";

export function toggleSpaceRow(t: SidebarSpacesState, row: HTMLElement, render: () => void, open?: boolean): void {
  const key = row.dataset["key"]!;
  if (open ?? !t.expanded.has(key)) t.expanded.add(key); else t.expanded.delete(key);
  t.saveExpanded([...t.expanded]);
  render();
}

export function activateSpaceRow(t: SidebarSpacesState, row: HTMLElement, render: () => void, twisty = false): boolean {
  if (row.dataset["allSpaces"] !== undefined) { t.spaces?.openCatalog(); return true; }
  const id = row.dataset["space"];
  if (!id) return false;
  if (twisty && row.hasAttribute("aria-expanded")) { toggleSpaceRow(t, row, render); return true; }
  const paper = row.dataset["spacePaper"];
  if (paper) t.spaces?.openPaper(paper);
  else {
    if (row.hasAttribute("aria-expanded")) toggleSpaceRow(t, row, render, true);
    t.spaces?.openSpace(id, row.dataset["spaceFolder"]);
  }
  return true;
}

async function deleteSpace(t: SidebarSpacesState, id: string): Promise<void> {
  if (await confirmDialog("Delete Space?", "Delete this Space and its references? Papers remain in your Library.", "Delete", true)) t.spaces?.deleteSpace(id);
}

async function deleteFolder(t: SidebarSpacesState, id: string, folder: string): Promise<void> {
  if (await confirmDialog("Delete folder?", "Delete this folder? Paper references remain in the Space.", "Delete", true)) t.spaces?.deleteFolder(id, folder);
}

export function spaceContextMenu(e: MouseEvent, t: SidebarSpacesState, row: HTMLElement | null): boolean {
  const id = row?.dataset["space"];
  if (!id || !t.spaces || !row) return false;
  e.preventDefault();
  const actions = t.spaces;
  const folder = row.dataset["spaceFolder"];
  const paper = row.dataset["spacePaper"];
  const entries: MenuEntry[] = paper ? [
    { label: "Open paper", onSelect: () => actions.openPaper(paper) },
    { label: "Remove from Space", onSelect: () => actions.removeReference(id, paper) },
  ] : folder ? [
    { label: "New folder", icon: "folder-plus", onSelect: () => actions.newFolder(id, folder) },
    { label: "Rename folder", onSelect: () => actions.renameFolder(id, folder) },
    { label: "Delete folder", danger: true, onSelect: () => { void deleteFolder(t, id, folder); } },
  ] : [
    { label: "New folder", icon: "folder-plus", onSelect: () => actions.newFolder(id) },
    { label: "Rename Space", onSelect: () => actions.renameSpace(id) },
    { label: "Delete Space", danger: true, onSelect: () => { void deleteSpace(t, id); } },
  ];
  showMenu({ x: e.clientX, y: e.clientY }, entries);
  return true;
}
