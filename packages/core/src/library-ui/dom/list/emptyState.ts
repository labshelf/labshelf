/**
 * Renders what the list shows instead of rows: a loading state before the first snapshot, otherwise the empty state
 * that fits (nothing matches, the folder or the library is empty) with its way out.
 */
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";

export interface EmptyStateOptions {
  narrowed: boolean;
  /** The library holds no paper in any folder. */
  libraryEmpty: boolean;
  query: string;
  folderLabel: string;
  /** How papers get into the library on this host. */
  hint: string;
  onClearFilters: () => void;
  /** Absent when papers cannot be added (a read-only library). */
  onAdd: (() => void) | null;
}

export function buildLoading(): HTMLElement {
  return el("div", { class: "list-loading", role: "status", html: `<span class="spin">${icon("loader")}</span> Loading papers…` });
}

function matchText(o: EmptyStateOptions): string {
  const query = o.query.trim();
  const scope = escapeHtml(o.folderLabel);
  return `No papers match ${query ? `“${escapeHtml(query)}” ` : ""}in ${scope}`;
}

function emptyText(o: EmptyStateOptions): string {
  return o.libraryEmpty ? "Your library has no papers yet" : `No papers in ${escapeHtml(o.folderLabel)} yet`;
}

function narrowedState(o: EmptyStateOptions): string {
  return `<div class="ls-empty-icon">${icon("search")}</div><div class="ls-empty-text">${matchText(o)}</div><button class="ls-btn" type="button">Clear filters</button>`;
}

export function buildEmptyState(o: EmptyStateOptions): HTMLElement {
  const box = el("div", { class: "ls-empty" });
  if (o.narrowed) {
    box.innerHTML = narrowedState(o);
    box.querySelector("button")!.addEventListener("click", o.onClearFilters);
    return box;
  }
  box.innerHTML = `<div class="ls-empty-icon">${icon("book")}</div>` +
    `<div class="ls-empty-text">${emptyText(o)}</div>` +
    (o.onAdd ? `<button class="ls-btn ls-btn-primary" type="button">${icon("plus")}<span>Add a paper</span></button>` : "") +
    `<div class="ls-empty-hint">${escapeHtml(o.hint)}</div>`;
  if (o.onAdd) box.querySelector("button")!.addEventListener("click", o.onAdd);
  return box;
}
