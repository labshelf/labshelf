// Builds the sidebar's rows: sub-headings, the All papers row, folders with recursive counts, papers with a REF label, tags, and projects.
import { PAPERS_DIR, ROOT_LABEL } from "../../../library/index.js";
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { SidebarProject } from "../../viewModel/index.js";

/** Row identity shared by focus, keyboard and click handling: `section:<id>`, `group:<id>`, `all-papers`, `folder:<path>`, `paper:<id>`, `tag:<tag>` or `project:<id>`. */
export const rowKey = (r: HTMLElement): string => r.dataset["key"] ?? "";

/** The depth of the rows directly under a Library group heading (Folders, Tags): one indent step past its chevron, as in VS Code's trees. */
export const GROUP_ROW_DEPTH = 1;

const countHtml = (count: number): string => (count > 0 ? `<span class="tree-count">${count}</span>` : "");

export function treeItem(key: string, depth: number, current: boolean, attrs: Record<string, string | undefined>, html: string): HTMLElement {
  return el("div", {
    class: `tree-row${current ? " current" : ""}${attrs["aria-expanded"] === "false" ? " collapsed" : ""}`,
    role: "treeitem",
    "data-key": key,
    style: `--depth:${depth}`,
    ...attrs,
    html,
  });
}

/** The row that opens the library root; `current` when the list shows it. */
export function allPapersRow(count: number, current: boolean): HTMLElement {
  return treeItem("all-papers", 0, current, { "data-all-papers": "", "aria-current": current ? "true" : undefined, "aria-selected": "false" },
    `<span class="tree-icon">${icon("book-open")}</span><span class="tree-label">${escapeHtml(ROOT_LABEL)}</span>${countHtml(count)}`);
}

/** The fixed row that opens the template gallery, as All papers opens the library root. */
export function exploreTemplatesRow(): HTMLElement {
  return treeItem("templates", 0, false, { "data-templates": "", "aria-selected": "false" },
    `<span class="tree-icon">${icon("layers")}</span><span class="tree-label">Explore templates</span>`);
}

/** The fixed row that opens the All projects tab, where archived and trashed projects live. */
export function allProjectsRow(): HTMLElement {
  return treeItem("allProjects", 0, false, { "data-all-projects": "", "aria-selected": "false" },
    `<span class="tree-icon">${icon("list")}</span><span class="tree-label">All projects</span>`);
}

export interface FolderRowState { depth: number; count: number; open: boolean; current: boolean }

export function folderRow(name: string, path: string, s: FolderRowState): HTMLElement {
  return treeItem(`folder:${path}`, s.depth, s.current, {
    "data-path": path,
    "aria-current": s.current ? "true" : undefined,
    "aria-selected": "false",
    "aria-expanded": String(s.open),
    title: path.slice(PAPERS_DIR.length + 1),
  }, `<span class="tree-twisty">${icon("chevron-down")}</span>` +
    `<span class="tree-label">${escapeHtml(name)}</span>` +
    countHtml(s.count));
}

/** A paper; its title ellipsizes, so the full title sits in the tooltip. */
export function paperRow(id: string, title: string, depth: number, selected: boolean): HTMLElement {
  return treeItem(`paper:${id}`, depth, false, { "data-id": id, "aria-selected": String(selected), title },
    `<span class="tree-twisty leaf">${icon("chevron-down")}</span><span class="tree-ref">REF</span><span class="tree-label">${escapeHtml(title)}</span>`);
}

/** A tag over the whole library; `current` when the list's search is exactly that tag. */
export function tagRow(tag: string, count: number, current: boolean): HTMLElement {
  return treeItem(`tag:${tag}`, GROUP_ROW_DEPTH, current, { "data-tag": tag, "aria-current": current ? "true" : undefined, "aria-selected": "false", title: `Show papers tagged ${tag}` },
    `<span class="tree-twisty leaf">${icon("chevron-down")}</span><span class="tree-label"><span class="tree-hash" aria-hidden="true">#</span>${escapeHtml(tag)}</span>${countHtml(count)}`);
}

export const formatLabel = (format: SidebarProject["format"]): string =>
  format ? `<span class="tree-ref ${format === "latex" ? "tex" : "typ"}">${format === "latex" ? "TEX" : "TYP"}</span>` : `<span class="tree-ref"></span>`;

/** A folder of My projects; it exists only while a project sits under it. */
export function projectFolderRow(name: string, path: string, s: FolderRowState): HTMLElement {
  return treeItem(`project-folder:${path}`, s.depth, false, { "data-project-folder": path, "aria-selected": "false", "aria-expanded": String(s.open), title: path },
    `<span class="tree-twisty">${icon("chevron-down")}</span><span class="tree-label">${escapeHtml(name)}</span>` + countHtml(s.count));
}

/** A writing project: its format label (TEX or TYP, like a paper's REF), name and optional count. */
export function projectRow(p: SidebarProject, depth: number): HTMLElement {
  return treeItem(`project:${p.id}`, depth, false, { "data-project": p.id, "aria-selected": "false", title: p.tooltip },
    `<span class="tree-twisty leaf">${icon("chevron-down")}</span>${formatLabel(p.format)}<span class="tree-label">${escapeHtml(p.name)}</span>` +
    (p.count ? `<span class="tree-count">${escapeHtml(p.count)}</span>` : ""));
}
