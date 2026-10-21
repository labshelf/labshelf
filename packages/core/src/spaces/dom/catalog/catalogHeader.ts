// Builds catalog controls while preserving the search input between row updates.
import { el, icon, inputBox, segmentedFilter } from "../../../ui/dom/index.js";
import type { SpacesTransport } from "../../protocol/index.js";
import type { CatalogFilter } from "../../view/index.js";

async function createSpace(end: SpacesTransport, signal: AbortSignal): Promise<void> {
  const name = await inputBox({ signal, title: "New Space", prompt: "Name your Space", validate: (value) => value.trim() ? null : "Enter a Space name" });
  if (name && !signal.aborted) end.post({ type: "createSpace", name });
}

export function catalogHeader(end: SpacesTransport, signal: AbortSignal): HTMLElement {
  const create = el("button", { class: "ls-btn ls-btn-primary", type: "button" },
    el("span", { "aria-hidden": "true", html: icon("plus") }), "New Space");
  create.addEventListener("click", () => void createSpace(end, signal));
  return el("header", { class: "catalog-head" }, el("div", {},
    el("h1", { text: "All Spaces" }), el("p", { text: "Keep your reading, notes and writing together." })), create);
}

export function catalogToolbar(filter: { text: string; scope: CatalogFilter["scope"] }, onChange: () => void): HTMLElement {
  const search = el("input", { type: "search", placeholder: "Search Spaces", "aria-label": "Search Spaces" });
  search.addEventListener("input", () => { filter.text = search.value; onChange(); });
  const filters = segmentedFilter({
    label: "Filter Spaces", selected: filter.scope,
    options: [{ id: "all", label: "All" }, { id: "personal", label: "Personal" }, { id: "shared", label: "Shared" }],
    onSelect: (id) => { filter.scope = id as CatalogFilter["scope"]; onChange(); },
  });
  return el("div", { class: "catalog-toolbar" },
    el("label", { class: "catalog-search" }, el("span", { "aria-hidden": "true", html: icon("search") }), search), filters);
}
