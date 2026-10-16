// Renders the gallery sidebar: source rows with counts and errors, the refresh button and the format checkboxes.
import { icon } from "../../../ui/index.js";
import { el } from "../../../ui/dom/index.js";
import { PROJECT_FORMATS, type ProjectFormat } from "../../project/index.js";
import type { SourceListing } from "../protocol/index.js";
import { TEMPLATE_SOURCES, type TemplateSourceId } from "../templateEntry.js";
import { FORMAT_LABELS, SOURCE_LABELS } from "../templateLabels.js";
import type { GalleryState } from "./galleryState.js";

export interface SourcesSidebarHandlers {
  /** The filter changed (source or formats); the sidebar has already patched itself. */
  onFilterChange(): void;
  /** Refresh was pressed; the state's listings are already back to loading. */
  onRefresh(): void;
}

export interface SourcesSidebar {
  element: HTMLElement;
  /** Patches counts, loading markers, errors and the selected row from the state. */
  update(): void;
}

/** `undefined` is "All sources". */
type Choice = TemplateSourceId | undefined;
const CHOICES: readonly Choice[] = [undefined, ...TEMPLATE_SOURCES];
const CACHED_TITLE = "Listed from this device; refreshes when online.";

interface Row { choice: Choice; item: HTMLLIElement; note: HTMLElement | null }

function noteNodes(listing: SourceListing): { nodes: Array<Node | string>; title?: string } {
  if (listing.status === "loading") return { nodes: [el("span", { class: "ls-tpl-spin", role: "img", "aria-label": "Loading", html: icon("loader") })] };
  if (listing.status === "error") return { nodes: [] };
  const count = String(listing.entries.length);
  return listing.fromCache ? { nodes: [`${count} · cached`], title: CACHED_TITLE } : { nodes: [count] };
}

function buildRow(choice: Choice): Row {
  const label = choice === undefined ? "All sources" : SOURCE_LABELS[choice];
  const note = choice === undefined ? null : el("span", { class: "ls-tpl-source-note" });
  const item = el("li", { class: "ls-tpl-source", role: "option", "aria-selected": "false", tabindex: -1 }, el("span", { class: "ls-tpl-source-label", text: label, title: label }), note);
  return { choice, item, note };
}

function buildFormats(state: GalleryState, onFilterChange: () => void): HTMLElement {
  const boxes = PROJECT_FORMATS.map((format) => ({ format, input: el("input", { type: "checkbox", checked: true }) }));
  const onChange = (): void => {
    state.setFormats(boxes.filter((box) => box.input.checked).map((box) => box.format as ProjectFormat));
    onFilterChange();
  };
  for (const box of boxes) box.input.addEventListener("change", onChange);
  return el("div", { class: "ls-tpl-formats" }, ...boxes.map((box) => el("label", { class: "ls-checkbox" }, box.input, el("span", { text: FORMAT_LABELS[box.format] }))));
}

function patchRows(rows: Row[], state: GalleryState): void {
  for (const row of rows) {
    const selected = row.choice === state.filter.source;
    row.item.setAttribute("aria-selected", String(selected));
    row.item.tabIndex = selected ? 0 : -1;
    if (row.note === null || row.choice === undefined) continue;
    const { nodes, title } = noteNodes(state.listings[row.choice]);
    row.note.replaceChildren(...nodes);
    row.note.title = title ?? "";
  }
}

function patchErrors(errors: HTMLElement, state: GalleryState): void {
  errors.replaceChildren(...TEMPLATE_SOURCES.flatMap((source) => {
    const listing = state.listings[source];
    return listing.status === "error"
      ? [el("div", { class: "ls-tpl-source-error", role: "status" }, el("span", { html: icon("warning") }), el("span", { text: `${SOURCE_LABELS[source]}: ${listing.message}` }))]
      : [];
  }));
}

export function createSourcesSidebar(state: GalleryState, handlers: SourcesSidebarHandlers): SourcesSidebar {
  const rows = CHOICES.map(buildRow);
  const list = el("ul", { class: "ls-tpl-sources", role: "listbox", "aria-label": "Sources" }, ...rows.map((row) => row.item));
  const errors = el("div", { class: "ls-tpl-source-errors" });
  const refresh = el("button", { class: "ls-icon-btn", type: "button", "aria-label": "Refresh templates", title: "Refresh templates", html: icon("refresh") });
  const element = el("nav", { class: "ls-tpl-sidebar", "aria-label": "Template filters" },
    el("div", { class: "ls-tpl-section" }, el("span", { text: "Sources" }), refresh),
    list, errors,
    el("div", { class: "ls-tpl-section" }, el("span", { text: "Format" })),
    buildFormats(state, handlers.onFilterChange));

  const update = (): void => {
    patchRows(rows, state);
    patchErrors(errors, state);
  };

  const select = (index: number): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))]!;
    const { source: _previous, ...rest } = state.filter;
    state.filter = row.choice === undefined ? rest : { ...rest, source: row.choice };
    update();
    row.item.focus();
    handlers.onFilterChange();
  };
  rows.forEach((row, index) => row.item.addEventListener("click", () => select(index)));
  list.addEventListener("keydown", (event) => {
    const current = rows.findIndex((row) => row.item === event.target);
    const target = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: rows.length - 1 }[event.key];
    if (current < 0 || target === undefined) return;
    event.preventDefault();
    select(target);
  });
  refresh.addEventListener("click", () => {
    state.loadAgain();
    update();
    handlers.onRefresh();
  });
  update();
  return { element, update };
}
