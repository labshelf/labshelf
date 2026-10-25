// Mounts the searchable Spaces catalog over its host message channel.
import { el, emptyState, icon, inputBox, segmentedFilter, memberChip, progressMark } from "../../../ui/dom/index.js";
import type { SpacesTransport, SpaceTab } from "../../protocol/index.js";
import { filterCatalog, type CatalogFilter, type CatalogRow } from "../../viewModel/index.js";
import { formatDay } from "../../../library/index.js";

function countLink(count: number, noun: string, open: () => void): HTMLButtonElement {
  const link = el("button", { type: "button", text: `${count} ${noun}${count === 1 ? "" : "s"}` });
  link.addEventListener("click", (event) => { event.stopPropagation(); open(); });
  return link;
}

function catalogRow(row: CatalogRow, end: SpacesTransport): HTMLElement {
  const article = el("article", { class: "catalog-row" });
  if (row.unreadable !== undefined) {
    article.append(el("div", { class: "catalog-main" },
      el("strong", { text: row.name }),
      el("p", { text: `spaces/${row.id}/space.json` }), el("p", { text: row.unreadable })));
    return article;
  }
  const open = (tab: SpaceTab): void => end.post({ type: "openSpace", id: row.id, tab });
  const title = el("button", { class: "catalog-title", type: "button", title: row.name },
    el("span", { "aria-hidden": "true", html: icon("layers") }), el("span", { text: row.name }));
  title.addEventListener("click", (event) => { event.stopPropagation(); open("overview"); });
  article.addEventListener("click", () => open("overview"));
  article.append(el("div", { class: "catalog-main" }, title,
    el("p", { text: row.purpose ?? "A personal place to read, collect ideas and explore." }),
    el("div", { class: "catalog-links" },
      countLink(row.counts.papers, "paper", () => open("papers")),
      countLink(row.counts.projects, "project", () => open("overview")))),
  el("div", { class: "catalog-reading", "aria-label": "Reading progress" }, progressMark(row.reading.done, row.reading.total),
    el("span", { text: `${row.reading.done} / ${row.reading.total} Done` })),
  el("div", { class: "catalog-next" }, row.next
    ? el("time", { datetime: row.next.date, title: row.next.date, text: formatDay(row.next.date) }) : el("span", { text: "No upcoming dates" }),
    row.next ? el("span", { text: row.next.title }) : null),
  el("div", { class: "catalog-members" }, el("span", { text: "Personal" }), el("div", {}, memberChip("You"))));
  return article;
}

async function createSpace(end: SpacesTransport, signal: AbortSignal): Promise<void> {
  const name = await inputBox({ signal, title: "New Space", prompt: "Choose a topic, a course or a research question. Press Enter to create.", placeholder: "e.g. Thesis literature review", validate: (value) => value.trim() ? null : "Enter a Space name" });
  if (name && !signal.aborted) end.post({ type: "createSpace", name });
}

function catalogHeader(end: SpacesTransport, signal: AbortSignal): HTMLElement {
  const create = el("button", { class: "ls-btn ls-btn-primary", type: "button" },
    el("span", { "aria-hidden": "true", html: icon("plus") }), "New Space");
  create.addEventListener("click", () => void createSpace(end, signal));
  return el("header", { class: "catalog-head" }, el("div", {},
    el("h1", { text: "All Spaces" }),
    el("p", { text: "Keep your reading, notes and writing together." })), create);
}

function catalogToolbar(filter: { text: string; scope: CatalogFilter["scope"] }, onChange: () => void): HTMLElement {
  const search = el("input", { type: "search", placeholder: "Search Spaces", "aria-label": "Search Spaces" });
  search.addEventListener("input", () => { filter.text = search.value; onChange(); });
  const filters = segmentedFilter({
    label: "Filter Spaces", selected: filter.scope,
    options: [{ id: "all", label: "All" }, { id: "personal", label: "Personal" }, { id: "shared", label: "Shared" }],
    onSelect: (id) => { filter.scope = id as CatalogFilter["scope"]; onChange(); },
  });
  return el("div", { class: "catalog-toolbar" },
    el("label", { class: "ls-search catalog-search" }, el("span", { "aria-hidden": "true", html: icon("search") }), search), filters);
}

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
