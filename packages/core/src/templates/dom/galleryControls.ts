// Holds the template gallery's state and renders its header (source tabs, format filter, refresh and publish) and its facet bar (search, sort and category).
import { renderIcon } from "../../ui/index.js";
import { renderElement, showMenu } from "../../ui/dom/index.js";
import { PROJECT_FORMATS, type ProjectFormat } from "../../writing/project/index.js";
import type { SourceListing, TemplateAddress } from "../host/index.js";
import { deriveFilteredTemplates, orderTemplates, TEMPLATE_SOURCES, type TemplateEntry, type TemplateFilter, type TemplateSort, type TemplateSourceId } from "../templateCatalog.js";
import { CATEGORY_LABELS, FORMAT_LABELS, SOURCE_LABELS } from "../templateLabels.js";
import { TEMPLATE_CATEGORIES, type TemplateKind } from "../templateManifest/index.js";

export const deriveTemplateAddress = (template: TemplateAddress): string => `${template.source}/${template.id}`;

export class GalleryState {
  readonly listings: Record<TemplateSourceId, SourceListing> = { community: { status: "loading" }, universe: { status: "loading" }, mine: { status: "loading" } };
  filter: TemplateFilter = {};
  sort: TemplateSort = "most-used";
  /** The entry whose detail page is open. */
  open: TemplateEntry | null = null;
  /** What the host said this machine lacks to build the open template. */
  openProblem: string | undefined;
  readonly thumbnails = new Map<string, string>();
  readonly busy = new Set<string>();
  private readonly requested = new Set<string>();

  setListing(source: TemplateSourceId, listing: SourceListing): void {
    this.listings[source] = listing;
    for (const requestedKey of [...this.requested]) if (requestedKey.startsWith(`${source}/`)) this.requested.delete(requestedKey);
  }

  loadAgain(): void {
    for (const source of TEMPLATE_SOURCES) this.setListing(source, { status: "loading" });
  }

  setFormats(checked: readonly ProjectFormat[]): void {
    this.filter = { ...this.filter, formats: checked.length === 2 ? [] : checked };
  }

  /** Every listed entry in source order, whatever the filter. */
  private listed(): TemplateEntry[] {
    return TEMPLATE_SOURCES.flatMap((source) => { const l = this.listings[source]; return l.status === "ready" ? l.entries : []; });
  }

  visible(): TemplateEntry[] {
    return orderTemplates(deriveFilteredTemplates(this.listed(), this.filter), this.sort);
  }

  count(source: TemplateSourceId): number {
    const listing = this.listings[source];
    return listing.status === "ready" ? listing.entries.length : 0;
  }

  statuses(): SourceListing["status"][] {
    return TEMPLATE_SOURCES.map((source) => this.listings[source].status);
  }

  /** Marks the templates not yet requested as requested and returns them. */
  takeUnrequested(templates: readonly TemplateAddress[]): TemplateAddress[] {
    const fresh = templates.filter((t) => !this.requested.has(deriveTemplateAddress(t)));
    for (const t of fresh) this.requested.add(deriveTemplateAddress(t));
    return fresh;
  }

  setThumbnail(template: TemplateAddress, dataUri: string | undefined): void {
    if (dataUri === undefined) this.thumbnails.delete(deriveTemplateAddress(template));
    else this.thumbnails.set(deriveTemplateAddress(template), dataUri);
  }

  isOpen(template: TemplateAddress): boolean {
    return this.open !== null && deriveTemplateAddress(this.open) === deriveTemplateAddress(template);
  }
}

export interface GalleryHeaderHandlers {
  onFilterChange(): void;
  onRefresh(): void;
  onPublish(): void;
}

export interface GalleryHeader {
  element: HTMLElement;
  update(): void;
  focusPublish(): void;
}

type SourceChoice = TemplateSourceId | undefined;
const SOURCE_CHOICES: readonly SourceChoice[] = [undefined, ...TEMPLATE_SOURCES];
const CACHED_TITLE = "Listed from this device; refreshes when online.";

interface Row { choice: SourceChoice; item: HTMLLIElement; note: HTMLElement | null }

function noteNodes(listing: SourceListing): { nodes: Array<Node | string>; title?: string } {
  if (listing.status === "loading") return { nodes: [renderElement("span", { class: "ls-tpl-spin", role: "img", "aria-label": "Loading", html: renderIcon("loader") })] };
  if (listing.status === "error") return { nodes: [] };
  const count = String(listing.entries.length);
  return listing.fromCache ? { nodes: [`${count} · cached`], title: CACHED_TITLE } : { nodes: [count] };
}

function buildRow(choice: SourceChoice): Row {
  const label = choice === undefined ? "All sources" : SOURCE_LABELS[choice];
  const note = choice === undefined ? null : renderElement("span", { class: "ls-tpl-source-note" });
  const item = renderElement("li", { class: "ls-tpl-source", role: "option", "aria-selected": "false", tabindex: -1 }, renderElement("span", { class: "ls-tpl-source-label", text: label, title: label }), note);
  return { choice, item, note };
}

function buildFormats(state: GalleryState, onFilterChange: () => void): HTMLElement {
  const boxes = PROJECT_FORMATS.map((format) => ({ format, input: renderElement("input", { type: "checkbox", checked: true }) }));
  const onChange = (): void => {
    state.setFormats(boxes.filter((box) => box.input.checked).map((box) => box.format as ProjectFormat));
    onFilterChange();
  };
  for (const box of boxes) box.input.addEventListener("change", onChange);
  return renderElement("div", { class: "ls-tpl-formats" }, ...boxes.map((box) => renderElement("label", { class: "ls-checkbox" }, box.input, renderElement("span", { text: FORMAT_LABELS[box.format] }))));
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
      ? [renderElement("div", { class: "ls-tpl-source-error", role: "status" }, renderElement("span", { html: renderIcon("warning") }), renderElement("span", { text: `${SOURCE_LABELS[source]}: ${listing.message}` }))]
      : [];
  }));
}

function buildHeader(list: HTMLElement, errors: HTMLElement, refresh: HTMLElement, publish: HTMLElement, formats: HTMLElement): HTMLElement {
  return renderElement("header", { class: "ls-tpl-header" },
    renderElement("div", { class: "ls-tpl-heading-row" },
      renderElement("div", { class: "ls-tpl-heading" },
        renderElement("h1", { class: "ls-tpl-title", text: "Templates" }),
        renderElement("p", { class: "ls-tpl-intro", text: "A starting point for your next paper." })),
      renderElement("div", { class: "ls-tpl-actions" }, refresh, publish)),
    renderElement("nav", { class: "ls-tpl-navigation", "aria-label": "Template filters" }, list,
      renderElement("div", { class: "ls-tpl-format-filter", role: "group", "aria-label": "Format" },
        renderElement("span", { class: "ls-tpl-filter-label", text: "Format" }), formats)),
    errors);
}

export function createGalleryHeader(state: GalleryState, handlers: GalleryHeaderHandlers): GalleryHeader {
  const rows = SOURCE_CHOICES.map(buildRow);
  const list = renderElement("ul", { class: "ls-tpl-sources", role: "listbox", "aria-label": "Sources", "aria-orientation": "horizontal" }, ...rows.map((row) => row.item));
  const errors = renderElement("div", { class: "ls-tpl-source-errors" });
  const refresh = renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", "aria-label": "Refresh templates", title: "Refresh templates" }, renderElement("span", { html: renderIcon("refresh") }), "Refresh");
  const publish = renderElement("button", { class: "ls-btn", type: "button" }, renderElement("span", { html: renderIcon("arrow-up") }), "Publish a template");
  publish.addEventListener("click", handlers.onPublish);
  const element = buildHeader(list, errors, refresh, publish, buildFormats(state, handlers.onFilterChange));

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
    const target = { ArrowRight: current + 1, ArrowLeft: current - 1, ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: rows.length - 1 }[event.key];
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
  return { element, update, focusPublish: () => publish.focus() };
}

export interface FacetBar {
  element: HTMLElement;
}

type CategoryChoice = TemplateKind | undefined;
const CATEGORY_CHOICES: readonly CategoryChoice[] = [undefined, ...TEMPLATE_CATEGORIES];

function buildSearch(onQuery: (query: string) => void): HTMLElement {
  const input = renderElement("input", { type: "search", "aria-label": "Search templates", placeholder: "Search templates, classes or authors…" });
  const clear = renderElement("button", { class: "ls-search-clear", type: "button", "aria-label": "Clear search", title: "Clear search (Esc)", html: renderIcon("x") });
  const box = renderElement("div", { class: "ls-search" }, renderElement("span", { html: renderIcon("search") }), input, clear);
  const set = (query: string): void => {
    input.value = query;
    box.classList.toggle("has-query", query !== "");
    onQuery(query);
  };
  input.addEventListener("input", () => set(input.value));
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") set(""); });
  clear.addEventListener("click", () => { set(""); input.focus(); });
  return box;
}

const SORT_LABELS: Record<TemplateSort, string> = { "most-used": "Most used", name: "Name" };

function buildSort(state: GalleryState, onSort: () => void): HTMLElement {
  const label = renderElement("span", { text: SORT_LABELS[state.sort] });
  const button = renderElement("button", { class: "ls-tpl-sort", type: "button", "aria-haspopup": "menu", "aria-label": "Sort templates" },
    renderElement("span", { class: "ls-tpl-sort-label", text: "Sort by" }), label, renderElement("span", { class: "ls-tpl-sort-chevron", html: renderIcon("chevron-down") }));
  button.addEventListener("click", () => {
    const rect = button.getBoundingClientRect();
    showMenu({ x: rect.left, y: rect.bottom + 2 }, (Object.keys(SORT_LABELS) as TemplateSort[]).map((sort) => ({
      label: SORT_LABELS[sort], checked: state.sort === sort, radio: true,
      onSelect: () => { state.sort = sort; label.textContent = SORT_LABELS[sort]; onSort(); },
    })), { onClose: () => button.focus() });
  });
  return button;
}

function buildCategories(onCategory: (category: CategoryChoice) => void): HTMLElement {
  const chips = CATEGORY_CHOICES.map((choice) => ({
    choice,
    button: renderElement("button", { class: "ls-tpl-category", type: "button", "aria-pressed": String(choice === undefined), text: choice === undefined ? "All" : CATEGORY_LABELS[choice] }),
  }));
  for (const chip of chips) {
    chip.button.addEventListener("click", () => {
      for (const other of chips) other.button.setAttribute("aria-pressed", String(other === chip));
      onCategory(chip.choice);
    });
  }
  const group = renderElement("div", { class: "ls-tpl-categories", role: "group", "aria-label": "Category" }, ...chips.map((chip) => chip.button));
  group.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const index = chips.findIndex((chip) => chip.button === event.target);
    if (step === 0 || index < 0) return;
    event.preventDefault();
    chips[(index + step + chips.length) % chips.length]!.button.focus();
  });
  return group;
}

export function createFacetBar(state: GalleryState, onFilterChange: () => void): FacetBar {
  const element = renderElement("div", { class: "ls-tpl-facets" },
    renderElement("div", { class: "ls-tpl-facets-row" },
      buildSearch((query) => { state.filter = { ...state.filter, query }; onFilterChange(); }),
      buildSort(state, onFilterChange)),
    buildCategories((category) => {
      const { category: _previous, ...rest } = state.filter;
      state.filter = category === undefined ? rest : { ...rest, category };
      onFilterChange();
    }));
  return { element };
}
