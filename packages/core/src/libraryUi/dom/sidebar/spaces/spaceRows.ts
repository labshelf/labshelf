// Builds nested Space, folder and reference rows using the sidebar tree vocabulary.
import { el } from "../../../../ui/dom/index.js";
import { escapeHtml, icon, statusMark } from "../../../../ui/index.js";
import { STATUS_LABEL } from "../../../../library/readingStatus/index.js";
import type { PapersTree, ResolvedPaper, SidebarRow } from "../../../../spaces/viewModel/index.js";
import { acceptSpaceDrop } from "./spaceDrop.js";
import type { SidebarSpacesState } from "./spaceActions.js";

function treeRow(key: string, label: string, depth: number, glyph: string, attrs: Record<string, string> = {}): HTMLElement {
  return el("div", {
    class: `tree-row${attrs["aria-expanded"] === "false" ? " collapsed" : ""}`, role: "treeitem", "aria-level": String(depth + 1),
    "aria-selected": "false", "data-key": key, style: `--depth:${depth}`, title: label, ...attrs,
    html: `<span class="tree-twisty${attrs["aria-expanded"] === undefined ? " leaf" : ""}">${icon("chevron-down")}</span>` +
      `<span class="tree-icon">${glyph}</span><span class="tree-label">${escapeHtml(label)}</span>`,
  });
}

function referenceRow(spaceId: string, paper: ResolvedPaper, depth: number): HTMLElement {
  const title = paper.missing ? "Not in your Library" : paper.title;
  const mark = paper.missing ? icon("warning") : `<span role="img" aria-label="${STATUS_LABEL[paper.status]}">${statusMark(paper.status)}</span>`;
  return treeRow(`space-paper:${spaceId}/${paper.id}`, title, depth, mark, { "data-space": spaceId, "data-space-paper": paper.id });
}

function appendTree(t: SidebarSpacesState, result: HTMLElement[], spaceId: string, tree: PapersTree, depth: number): void {
  for (const folder of tree.folders) {
    const key = `space-folder:${spaceId}/${folder.id}`;
    const row = treeRow(key, folder.name, depth, icon("folder"), {
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
  const row = treeRow(key, space.name, 0, icon("layers"), {
    "data-space": space.id, ...("tree" in space ? { "aria-expanded": String(t.expanded.has(key)) } : {}),
  });
  result.push(row);
  if ("unreadable" in space) row.title = `${space.id}: ${space.unreadable}`;
  else {
    if (t.spaces) acceptSpaceDrop(row, t.spaces, space.id);
    if (t.expanded.has(key)) appendTree(t, result, space.id, space.tree, 1);
  }
}

export function spaceRows(t: SidebarSpacesState): HTMLElement[] {
  const rows = [treeRow("all-spaces", "All Spaces", 0, icon("layers"), { "data-all-spaces": "" })];
  for (const space of t.spaceList) {
    const branch: HTMLElement[] = [];
    appendSpace(t, branch, space);
    rows.push(...branch);
  }
  return rows;
}
