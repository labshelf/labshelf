// The Spaces section of the sidebar: its rows, the host actions it offers, and the routing of clicks, drops and menus on a row.
import { renderElement, askDialog, showMenu, type MenuEntry } from "../../../ui/dom/index.js";
import { escapeHtml, renderIcon, renderReadingStatusMark } from "../../../ui/index.js";
import { STATUS_LABEL } from "../../../library/index.js";
import type { PapersTree, ResolvedPaper, SidebarRow } from "../../../spaces/index.js";
import type { SidebarSpaceActions } from "./librarySidebar.js";
import { PAPER_DRAG_MIME, acceptsPaperDrop, parsePaperDragPayload } from "../paperDrag.js";

function acceptSpaceDrop(row: HTMLElement, actions: SidebarSpaceActions, id: string, folder?: string): void {
  row.addEventListener("dragover", (event) => {
    if (!acceptsPaperDrop(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    row.classList.add("drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
  row.addEventListener("drop", (event) => {
    row.classList.remove("drop-target");
    if (!acceptsPaperDrop(event)) return;
    event.preventDefault();
    const ids = parsePaperDragPayload(event.dataTransfer?.getData(PAPER_DRAG_MIME) ?? "[]");
    if (ids.length) actions.dropPapers(id, folder, ids);
  });
}

function treeRow(key: string, label: string, depth: number, glyph: string, attrs: Record<string, string> = {}): HTMLElement {
  return renderElement("div", {
    class: `tree-row${attrs["aria-expanded"] === "false" ? " collapsed" : ""}`, role: "treeitem", "aria-level": String(depth + 1),
    "aria-selected": "false", "data-key": key, style: `--depth:${depth}`, title: label, ...attrs,
    html: `<span class="tree-twisty${attrs["aria-expanded"] === undefined ? " leaf" : ""}">${renderIcon("chevron-down")}</span>` +
      `<span class="tree-icon">${glyph}</span><span class="tree-label">${escapeHtml(label)}</span>`,
  });
}

function referenceRow(spaceId: string, paper: ResolvedPaper, depth: number): HTMLElement {
  const title = paper.missing ? "Not in your Library" : paper.title;
  const mark = paper.missing ? renderIcon("warning") : `<span role="img" aria-label="${STATUS_LABEL[paper.status]}">${renderReadingStatusMark(paper.status)}</span>`;
  return treeRow(`space-paper:${spaceId}/${paper.id}`, title, depth, mark, { "data-space": spaceId, "data-space-paper": paper.id });
}

function appendTree(t: SidebarSpacesState, result: HTMLElement[], spaceId: string, tree: PapersTree, depth: number): void {
  for (const folder of tree.folders) {
    const key = `space-folder:${spaceId}/${folder.id}`;
    const row = treeRow(key, folder.name, depth, renderIcon("folder"), {
      "data-space": spaceId, "data-space-folder": folder.id, "aria-expanded": String(t.expanded.has(key)),
    });
    if (t.spaces) acceptSpaceDrop(row, t.spaces, spaceId, folder.id);
    result.push(row);
    if (t.expanded.has(key)) appendTree(t, result, spaceId, folder, depth + 1);
  }
  for (const paper of tree.papers) result.push(referenceRow(spaceId, paper, depth));
}

function appendSpace(t: SidebarSpacesState, result: HTMLElement[], space: SidebarRow): void {
  const key = `space:${space.id}`;
  const row = treeRow(key, space.name, 0, renderIcon("layers"), {
    "data-space": space.id, ...("tree" in space ? { "aria-expanded": String(t.expanded.has(key)) } : {}),
  });
  result.push(row);
  if ("unreadable" in space) row.title = `${space.id}: ${space.unreadable}`;
  else {
    if (t.spaces) acceptSpaceDrop(row, t.spaces, space.id);
    if (t.expanded.has(key)) appendTree(t, result, space.id, space.tree, 1);
  }
}

export function renderSpaceRows(t: SidebarSpacesState): HTMLElement[] {
  const rows = [treeRow("all-spaces", "All Spaces", 0, renderIcon("layers"), { "data-all-spaces": "" })];
  for (const space of t.spaceList) {
    const branch: HTMLElement[] = [];
    appendSpace(t, branch, space);
    rows.push(...branch);
  }
  return rows;
}

export interface SidebarSpacesState {
  spaces: SidebarSpaceActions | undefined;
  spaceList: readonly SidebarRow[];
  expanded: Set<string>;
  saveExpanded(paths: string[]): void;
}

export function updateSpaceRowOpen(t: SidebarSpacesState, row: HTMLElement, render: () => void, open?: boolean): void {
  const key = row.dataset["key"]!;
  if (open ?? !t.expanded.has(key)) t.expanded.add(key); else t.expanded.delete(key);
  t.saveExpanded([...t.expanded]);
  render();
}

export function runSpaceRow(t: SidebarSpacesState, row: HTMLElement, render: () => void, twisty = false): boolean {
  if (row.dataset["allSpaces"] !== undefined) { t.spaces?.openCatalog(); return true; }
  const id = row.dataset["space"];
  if (!id) return false;
  if (twisty && row.hasAttribute("aria-expanded")) { updateSpaceRowOpen(t, row, render); return true; }
  const paper = row.dataset["spacePaper"];
  if (paper) t.spaces?.openPaper(paper);
  else {
    if (row.hasAttribute("aria-expanded")) updateSpaceRowOpen(t, row, render, true);
    t.spaces?.openSpace(id, row.dataset["spaceFolder"]);
  }
  return true;
}

async function deleteSpace(t: SidebarSpacesState, id: string): Promise<void> {
  if (await askDialog("Delete Space?", "Delete this Space and its references? Papers remain in your Library.", "Delete", true)) t.spaces?.deleteSpace(id);
}

async function deleteFolder(t: SidebarSpacesState, id: string, folder: string): Promise<void> {
  if (await askDialog("Delete folder?", "Delete this folder? Paper references remain in the Space.", "Delete", true)) t.spaces?.deleteFolder(id, folder);
}

export function showSpaceMenu(e: MouseEvent, t: SidebarSpacesState, row: HTMLElement | null): boolean {
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
