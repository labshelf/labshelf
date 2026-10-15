/**
 * Renders what the list shows instead of rows: "Loading…" before the first snapshot, otherwise the empty state
 * that fits (no PDF lacks text, nothing matches, every paper is in a subfolder, the folder is empty) with its way out.
 */
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";

export interface EmptyStateOptions {
  narrowed: boolean;
  /** The No text filter is the only filter on. */
  onlyNoText: boolean;
  onlyNested: boolean;
  folderLabel: string;
  /** How papers get into the library on this host. */
  hint: string;
  onClearFilters: () => void;
  onShowSubfolders: () => void;
  onAdd: () => void;
}

export function buildLoading(): HTMLElement {
  return el("div", { class: "list-loading", text: "Loading…" });
}

function narrowedState(o: EmptyStateOptions): string {
  // Reached once the last scan here was made searchable: say so plainly.
  return o.onlyNoText
    ? `<div class="ls-empty-icon">${icon("file")}</div><div class="ls-empty-text">No paper in ${escapeHtml(o.folderLabel)} is missing its text layer</div><button class="ls-btn" type="button">Show all papers</button>`
    : `<div class="ls-empty-icon">${icon("search")}</div><div class="ls-empty-text">No papers match in ${escapeHtml(o.folderLabel)}</div><button class="ls-btn" type="button">Clear filters</button>`;
}

export function buildEmptyState(o: EmptyStateOptions): HTMLElement {
  const box = el("div", { class: "ls-empty" });
  if (o.narrowed) {
    box.innerHTML = narrowedState(o);
    box.querySelector("button")!.addEventListener("click", o.onClearFilters);
    return box;
  }
  box.innerHTML = `<div class="ls-empty-icon">${icon("book")}</div>` +
    `<div class="ls-empty-text">${o.onlyNested ? "All papers here are inside subfolders" : "No papers here yet"}</div>` +
    `<button class="ls-btn ls-btn-primary" type="button">${o.onlyNested ? "Show papers from subfolders" : `${icon("plus")}<span>Add a paper</span>`}</button>` +
    (o.onlyNested ? "" : `<div class="ls-empty-hint">${escapeHtml(o.hint)}</div>`);
  box.querySelector("button")!.addEventListener("click", o.onlyNested ? o.onShowSubfolders : o.onAdd);
  return box;
}
