// Builds the sidebar's rows: sub-headings, the All papers row, folders with recursive counts, papers with a REF label, tags, and projects.
import { PAPERS_DIR, ROOT_LABEL } from "../../../library/index.js";
import { el } from "../../../ui/dom/index.js";
import { arcMark, escapeHtml, icon } from "../../../ui/index.js";
import type { SidebarProject } from "./sidebarProjects.js";

/** Row identity shared by focus, keyboard and click handling: `section:<id>`, `group:<id>`, `all-papers`, `folder:<path>`, `paper:<id>`, `tag:<tag>` or `project:<id>`. */
export const rowKey = (r: HTMLElement): string => r.dataset["key"] ?? "";

/** The depth of the rows directly under a Library group heading (Folders, Tags): their twisty starts past its label's start. */
export const GROUP_ROW_DEPTH = 3;

const countHtml = (count: number): string => (count > 0 ? `<span class="tree-count">${count}</span>` : "");

function treeItem(key: string, depth: number, current: boolean, attrs: Record<string, string | undefined>, html: string): HTMLElement {
  return el("div", {
    class: `tree-row${current ? " current" : ""}${attrs["aria-expanded"] === "false" ? " collapsed" : ""}`,
    role: "treeitem",
    "data-key": key,
    style: `--depth:${depth}`,
    ...attrs,
    html,
  });
}

/** A static sub-heading; `actions` holds icon buttons shown on hover. */
export function headingRow(text: string, actions = ""): HTMLElement {
  return el("div", { class: "tree-heading", role: "presentation", html: `<span>${escapeHtml(text)}</span>${actions ? `<span class="tree-heading-actions">${actions}</span>` : ""}` });
}

/** The row that opens the library root; `current` when the list shows it. */
export function allPapersRow(count: number, current: boolean): HTMLElement {
  return treeItem("all-papers", 0, current, { "data-all-papers": "", "aria-current": current ? "true" : undefined, "aria-selected": "false" },
    `<span class="tree-icon">${icon("book-open")}</span><span class="tree-label">${escapeHtml(ROOT_LABEL)}</span>${countHtml(count)}`);
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

/** A writing project: its progress mark, name and optional count. */
export function projectRow(p: SidebarProject): HTMLElement {
  return treeItem(`project:${p.id}`, 0, false, { "data-project": p.id, "aria-selected": "false", title: p.tooltip },
    `<span class="tree-icon">${arcMark(p.mark.tone, p.mark.progress)}</span><span class="tree-label">${escapeHtml(p.name)}</span>` +
    (p.count ? `<span class="tree-count">${escapeHtml(p.count)}</span>` : ""));
}
