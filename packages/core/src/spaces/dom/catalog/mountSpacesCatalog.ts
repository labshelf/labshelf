// Mounts the searchable Spaces catalog over its host message channel.
import { el, emptyState } from "../../../ui/dom/index.js";
import type { SpacesTransport } from "../../protocol/index.js";
import { filterCatalog, type CatalogFilter, type CatalogRow } from "../../viewModel/index.js";
import { catalogHeader, catalogToolbar, createSpace } from "./catalogHeader.js";
import { catalogRow } from "./catalogRow.js";

export function mountSpacesCatalog(root: HTMLElement, end: SpacesTransport): () => void {
  const lifecycle = new AbortController();
  let rows: readonly CatalogRow[] = [];
  const filter: CatalogFilter = { text: "", scope: "all" };
  const list = el("div", { class: "catalog-list" });
  const count = el("span");
  const error = el("div", { class: "catalog-error", role: "alert", hidden: true });
  const render = (): void => {
    const visible = filterCatalog(rows, filter);
    count.textContent = `${visible.length} ${visible.length === 1 ? "Space" : "Spaces"}`;
    list.replaceChildren(...(visible.length ? visible.map((row) => catalogRow(row, end)) : [
      emptyState(rows.length || filter.text || filter.scope !== "all"
        ? { text: "No matching Spaces.", hint: "Try another name or filter.", icon: "search" }
        : { text: "No Spaces yet.", hint: "Create a Space to organise papers and projects around a topic.", icon: "layers",
          action: { label: "Create your first Space", primary: true, onClick: () => void createSpace(end, lifecycle.signal) } }),
    ]));
  };
  const page = el("div", { class: "catalog" }, catalogHeader(end, lifecycle.signal), catalogToolbar(filter, render), error,
    el("div", { class: "catalog-columns", "aria-hidden": "true" }, count, el("span", { text: "Reading" }),
      el("span", { text: "Up next" }), el("span", { text: "Members" })), list,
    el("p", { class: "catalog-hint", text: "Spaces group references. Papers stay in your Library." }));
  root.replaceChildren(page);
  const unsubscribe = end.subscribe((message) => {
    if (message.type === "catalog") { rows = message.rows; error.hidden = true; error.textContent = ""; render(); }
    else if (message.type === "error") { error.hidden = false; error.textContent = `${message.action}: ${message.message}`; }
  });
  render();
  end.post({ type: "ready", view: "catalog" });
  return () => { unsubscribe(); lifecycle.abort(); page.remove(); };
}
