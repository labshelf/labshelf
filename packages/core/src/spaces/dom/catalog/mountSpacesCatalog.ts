// Mounts the searchable Spaces catalog over its host message channel.
import { renderElement, renderEmptyNotice, renderIcon, askInputBox, renderSegmentedFilter, renderMemberChip, renderProgressMark } from "../../../ui/dom/index.js";
import type { SpacesTransport, SpaceTab } from "../../protocol/index.js";
import { deriveFilteredCatalogRows, type CatalogFilter, type CatalogRow } from "../../viewModel/index.js";
import { formatDay } from "../../../library/index.js";

function countLink(count: number, noun: string, open: () => void): HTMLButtonElement {
  const link = renderElement("button", { type: "button", text: `${count} ${noun}${count === 1 ? "" : "s"}` });
  link.addEventListener("click", (event) => { event.stopPropagation(); open(); });
  return link;
}

function catalogRow(row: CatalogRow, end: SpacesTransport): HTMLElement {
  const article = renderElement("article", { class: "catalog-row" });
  if (row.unreadable !== undefined) {
    article.append(renderElement("div", { class: "catalog-main" },
      renderElement("strong", { text: row.name }),
      renderElement("p", { text: `spaces/${row.id}/space.json` }), renderElement("p", { text: row.unreadable })));
    return article;
  }
  const open = (tab: SpaceTab): void => end.post({ type: "openSpace", id: row.id, tab });
  const title = renderElement("button", { class: "catalog-title", type: "button", title: row.name },
    renderElement("span", { "aria-hidden": "true", html: renderIcon("layers") }), renderElement("span", { text: row.name }));
  title.addEventListener("click", (event) => { event.stopPropagation(); open("overview"); });
  article.addEventListener("click", () => open("overview"));
  article.append(renderElement("div", { class: "catalog-main" }, title,
    renderElement("p", { text: row.purpose ?? "A personal place to read, collect ideas and explore." }),
    renderElement("div", { class: "catalog-links" },
      countLink(row.counts.papers, "paper", () => open("papers")),
      countLink(row.counts.projects, "project", () => open("overview")))),
  renderElement("div", { class: "catalog-reading", "aria-label": "Reading progress" }, renderProgressMark(row.reading.done, row.reading.total),
    renderElement("span", { text: `${row.reading.done} / ${row.reading.total} Done` })),
  renderElement("div", { class: "catalog-next" }, row.next
    ? renderElement("time", { datetime: row.next.date, title: row.next.date, text: formatDay(row.next.date) }) : renderElement("span", { text: "No upcoming dates" }),
    row.next ? renderElement("span", { text: row.next.title }) : null),
  renderElement("div", { class: "catalog-members" }, renderElement("span", { text: "Personal" }), renderElement("div", {}, renderMemberChip("You"))));
  return article;
}

async function createSpace(end: SpacesTransport, signal: AbortSignal): Promise<void> {
  const name = await askInputBox({ signal, title: "New Space", prompt: "Choose a topic, a course or a research question. Press Enter to create.", placeholder: "e.g. Thesis literature review", validate: (value) => value.trim() ? null : "Enter a Space name" });
  if (name && !signal.aborted) end.post({ type: "createSpace", name });
}

function catalogHeader(end: SpacesTransport, signal: AbortSignal): HTMLElement {
  const create = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button" },
    renderElement("span", { "aria-hidden": "true", html: renderIcon("plus") }), "New Space");
  create.addEventListener("click", () => void createSpace(end, signal));
  return renderElement("header", { class: "catalog-head" }, renderElement("div", {},
    renderElement("h1", { text: "All Spaces" }),
    renderElement("p", { text: "Keep your reading, notes and writing together." })), create);
}

function catalogToolbar(filter: { text: string; scope: CatalogFilter["scope"] }, onChange: () => void): HTMLElement {
  const search = renderElement("input", { type: "search", placeholder: "Search Spaces", "aria-label": "Search Spaces" });
  search.addEventListener("input", () => { filter.text = search.value; onChange(); });
  const filters = renderSegmentedFilter({
    label: "Filter Spaces", selected: filter.scope,
    options: [{ id: "all", label: "All" }, { id: "personal", label: "Personal" }, { id: "shared", label: "Shared" }],
    onSelect: (id) => { filter.scope = id as CatalogFilter["scope"]; onChange(); },
  });
  return renderElement("div", { class: "catalog-toolbar" },
    renderElement("label", { class: "ls-search catalog-search" }, renderElement("span", { "aria-hidden": "true", html: renderIcon("search") }), search), filters);
}

export function mountSpacesCatalog(root: HTMLElement, end: SpacesTransport): () => void {
  const lifecycle = new AbortController();
  let rows: readonly CatalogRow[] = [];
  const filter: CatalogFilter = { text: "", scope: "all" };
  const list = renderElement("div", { class: "catalog-list" });
  const count = renderElement("span");
  const error = renderElement("div", { class: "catalog-error", role: "alert", hidden: true });
  const render = (): void => {
    const visible = deriveFilteredCatalogRows(rows, filter);
    count.textContent = `${visible.length} ${visible.length === 1 ? "Space" : "Spaces"}`;
    list.replaceChildren(...(visible.length ? visible.map((row) => catalogRow(row, end)) : [
      renderEmptyNotice(rows.length || filter.text || filter.scope !== "all"
        ? { text: "No matching Spaces.", hint: "Try another name or filter.", icon: "search" }
        : { text: "No Spaces yet.", hint: "Create a Space to organise papers and projects around a topic.", icon: "layers",
          action: { label: "Create your first Space", primary: true, onClick: () => void createSpace(end, lifecycle.signal) } }),
    ]));
  };
  const page = renderElement("div", { class: "catalog" }, catalogHeader(end, lifecycle.signal), catalogToolbar(filter, render), error,
    renderElement("div", { class: "catalog-columns", "aria-hidden": "true" }, count, renderElement("span", { text: "Reading" }),
      renderElement("span", { text: "Up next" }), renderElement("span", { text: "Members" })), list,
    renderElement("p", { class: "catalog-hint", text: "Spaces group references. Papers stay in your Library." }));
  root.replaceChildren(page);
  const unsubscribe = end.subscribe((message) => {
    if (message.type === "catalog") { rows = message.rows; error.hidden = true; error.textContent = ""; render(); }
    else if (message.type === "error") { error.hidden = false; error.textContent = `${message.action}: ${message.message}`; }
  });
  render();
  end.post({ type: "ready", view: "catalog" });
  return () => { unsubscribe(); lifecycle.abort(); page.remove(); };
}
