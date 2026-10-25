// Renders search, sorting and category filters for the template gallery.
import { renderIcon } from "../../ui/index.js";
import { renderElement, showMenu } from "../../ui/dom/index.js";
import { TEMPLATE_CATEGORIES, type TemplateKind } from "../templateManifest/index.js";
import { CATEGORY_LABELS } from "../templateLabels.js";
import type { TemplateSort } from "../orderTemplates.js";
import type { GalleryState } from "./galleryState.js";

export interface FacetBar {
  element: HTMLElement;
}

type Choice = TemplateKind | undefined;
const CHOICES: readonly Choice[] = [undefined, ...TEMPLATE_CATEGORIES];

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

function buildCategories(onCategory: (category: Choice) => void): HTMLElement {
  const chips = CHOICES.map((choice) => ({
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
