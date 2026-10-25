// Builds nested Space, folder and reference rows using the sidebar tree vocabulary.
import { renderElement } from "../../../../ui/dom/index.js";
import { escapeHtml, renderIcon, renderReadingStatusMark } from "../../../../ui/index.js";
import { STATUS_LABEL } from "../../../../library/readingStatus/index.js";
import type { PapersTree, ResolvedPaper, SidebarRow } from "../../../../spaces/viewModel/index.js";
import type { SidebarSpacesState, SidebarSpaceActions } from "./spaceActions.js";
import { PAPER_DRAG_MIME, parsePaperDragPayload } from "../../drag/index.js";

function acceptSpaceDrop(row: HTMLElement, actions: SidebarSpaceActions, id: string, folder?: string): void {
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
