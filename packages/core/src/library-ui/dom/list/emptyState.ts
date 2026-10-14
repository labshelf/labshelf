/**
 * What the list shows instead of rows: "Loading…" before the first snapshot, otherwise one of three empty states
 * (nothing matches the filters, every paper sits in a subfolder, the folder is empty), each with its way out.
 */
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";

export interface EmptyStateOptions {
  narrowed: boolean;
  onlyNested: boolean;
  folderLabel: string;
  onClearFilters: () => void;
  onShowSubfolders: () => void;
  onAdd: () => void;
}

export function buildLoading(): HTMLElement {
  return el("div", { class: "list-loading", text: "Loading…" });
}

export function buildEmptyState(o: EmptyStateOptions): HTMLElement {
  const box = el("div", { class: "ls-empty" });
  if (o.narrowed) {
    box.innerHTML = `<div class="ls-empty-icon">${icon("search")}</div><div class="ls-empty-text">No papers match in ${escapeHtml(o.folderLabel)}</div>` +
      `<button class="ls-btn" type="button">Clear filters</button>`;
    box.querySelector("button")!.addEventListener("click", o.onClearFilters);
    return box;
  }
  box.innerHTML = `<div class="ls-empty-icon">${icon("book")}</div>` +
    `<div class="ls-empty-text">${o.onlyNested ? "All papers here are inside subfolders" : "No papers here yet"}</div>` +
    `<button class="ls-btn ls-btn-primary" type="button">${o.onlyNested ? "Show papers from subfolders" : `${icon("plus")}<span>Add a paper</span>`}</button>` +
    (o.onlyNested ? "" : `<div class="ls-empty-hint">Open the paper's page in a tab and use the LabShelf toolbar button, or click Add to pick one of your open tabs.</div>`);
  box.querySelector("button")!.addEventListener("click", o.onlyNested ? o.onShowSubfolders : o.onAdd);
  return box;
}
