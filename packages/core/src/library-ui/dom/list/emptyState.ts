/**
 * Renders what the list shows instead of rows: a loading state before the first snapshot, otherwise the empty state
 * that fits (nothing matches, the folder or the library is empty) with its way out.
 */
import { el, emptyState } from "../../../ui/dom/index.js";
import { icon } from "../../../ui/index.js";

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
  return `No papers match ${query ? `“${query}” ` : ""}in ${o.folderLabel}`;
}

function emptyText(o: EmptyStateOptions): string {
  return o.libraryEmpty ? "Your library has no papers yet" : `No papers in ${o.folderLabel} yet`;
}

export function buildEmptyState(o: EmptyStateOptions): HTMLElement {
  if (o.narrowed) return emptyState({ icon: "search", text: matchText(o), action: { label: "Clear filters", onClick: o.onClearFilters } });
  return emptyState({
    icon: "book", text: emptyText(o), hint: o.hint,
    ...(o.onAdd && { action: { label: "Add a paper", icon: "plus", primary: true, onClick: o.onAdd } }),
  });
}
