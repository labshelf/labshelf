// Builds the sidebar tree's rows: status scopes, folders with recursive counts and drop targets, and papers with a REF label.
import { PAPERS_DIR, ROOT_LABEL, STATUS_LABEL, escapeHtml, icon, statusMark, type StatusFilter } from "@labshelf/core";
import { el } from "@labshelf/core/dom";

/** Row identity shared by focus, keyboard and click handling: `scope:<status>`, `folder:<path>` or `paper:<id>`. */
export const rowKey = (r: HTMLElement): string => r.dataset["key"] ?? "";

const SCOPE_LABEL: Record<StatusFilter, string> = { all: ROOT_LABEL, ...STATUS_LABEL };

const countHtml = (count: number): string => (count > 0 ? `<span class="tree-count">${count}</span>` : "");
const guidesHtml = (depth: number): string =>
  Array.from({ length: depth }, (_, i) => `<span class="guide" style="left:${16 + i * 8}px"></span>`).join("");

function treeItem(key: string, depth: number, marked: boolean, attrs: Record<string, string | undefined>, html: string): HTMLElement {
  return el("div", {
    class: `tree-row${marked ? " selected" : ""}${attrs["aria-expanded"] === "false" ? " collapsed" : ""}`,
    role: "treeitem",
    "data-key": key,
    style: `--depth:${depth}`,
    ...attrs,
    html,
  });
}

/** A status scope over the whole library; `current` when the list shows the library root with that status. */
export function scopeRow(scope: StatusFilter, count: number, current: boolean): HTMLElement {
  const mark = scope === "all" ? icon("library") : statusMark(scope);
  return treeItem(`scope:${scope}`, 0, current, { "data-scope": scope, "aria-current": current ? "true" : undefined, "aria-selected": "false" },
    `<span class="tree-twisty leaf">${icon("chevron-down")}</span><span class="tree-icon">${mark}</span>` +
      `<span class="tree-label">${escapeHtml(SCOPE_LABEL[scope])}</span>${countHtml(count)}`);
}

export interface FolderRowState { depth: number; count: number; expandable: boolean; open: boolean; current: boolean }

export function folderRow(name: string, path: string, s: FolderRowState): HTMLElement {
  return treeItem(`folder:${path}`, s.depth, s.current, {
    "data-path": path,
    "aria-current": s.current ? "true" : undefined,
    "aria-selected": "false",
    "aria-expanded": s.expandable ? String(s.open) : undefined,
    title: path.slice(PAPERS_DIR.length + 1),
  }, `${guidesHtml(s.depth)}<span class="tree-twisty${s.expandable ? "" : " leaf"}">${icon("chevron-down")}</span>` +
    `<span class="tree-icon">${icon("folder")}</span><span class="tree-label">${escapeHtml(name)}</span>${countHtml(s.count)}` +
    `<span class="tree-row-actions"><button class="ls-icon-btn" data-action="new" title="New subfolder" tabindex="-1">${icon("folder-plus")}</button></span>`);
}

/** A paper; its title ellipsizes, so the full title sits in the tooltip. */
export function paperRow(id: string, title: string, depth: number, selected: boolean): HTMLElement {
  return treeItem(`paper:${id}`, depth, selected, { "data-id": id, "aria-selected": String(selected), title },
    `${guidesHtml(depth)}<span class="tree-twisty leaf">${icon("chevron-down")}</span>` +
      `<span class="tree-ref">REF</span><span class="tree-label">${escapeHtml(title)}</span>`);
}
