// Mounts the searchable Spaces catalog over its host message channel.
import { renderElement, renderPageHeading, renderEmptyNotice, renderIcon, askInputBox, askDialog, showMenu, showToast, mountPlaceHeader, renderProgressMark, type MenuEntry } from "../../ui/dom/index.js";
import type { IconName } from "../../ui/icons/index.js";
import type { SpacesTransport, SpaceTab } from "../spacesProtocol.js";
import { deriveFilteredCatalogRows, countCatalogPlaces, type CatalogFilter, type CatalogRow } from "../spaceViews.js";
import type { SpacePlace } from "../space.js";
import { formatDay } from "../../time/index.js";
import { formatCount } from "../../ui/index.js";

function countLink(count: number, noun: string, icon: IconName, open: () => void): HTMLButtonElement {
  const link = renderElement("button", { type: "button" },
    renderElement("span", { "aria-hidden": "true", html: renderIcon(icon) }), formatCount(count, noun));
  link.addEventListener("click", (event) => { event.stopPropagation(); open(); });
  return link;
}

function cardItem(icon: IconName, title: string, detail: Node | string): HTMLElement {
  return renderElement("div", { class: "catalog-item" },
    renderElement("span", { class: "catalog-item-icon", "aria-hidden": "true", html: renderIcon(icon) }),
    renderElement("div", {}, renderElement("strong", { text: title }), renderElement("span", {}, detail)));
}

/** The "…" menu entries of a card: Open and Archive in Spaces, Unarchive in Archived, Restore and Delete forever in Trash. */
function spaceMenuEntries(row: CatalogRow, end: SpacesTransport, open: () => void): MenuEntry[] {
  const toTrash: MenuEntry = { label: "Move to Trash", icon: "trash", onSelect: () => end.post({ type: "setTrashed", id: row.id, trashed: true }) };
  if (row.place === "trash") {
    return [
      { label: "Restore", icon: "refresh", onSelect: () => end.post({ type: "setTrashed", id: row.id, trashed: false }) },
      { label: "Delete forever…", icon: "trash", danger: true, onSelect: () => void deleteForever(row, end) },
    ];
  }
  const archived = row.place === "archived";
  return [{ label: "Open", icon: "layers", onSelect: open },
    { label: archived ? "Unarchive" : "Archive", onSelect: () => end.post({ type: "setArchived", id: row.id, archived: !archived }) }, toTrash];
}

async function deleteForever(row: CatalogRow, end: SpacesTransport): Promise<void> {
  const ok = await askDialog(`Delete ${row.name} forever?`, "Its folder moves to your system trash. Papers and projects stay where they are.", "Delete forever", true);
  if (ok) end.post({ type: "deleteSpace", id: row.id });
}

async function emptyTrash(count: number, end: SpacesTransport): Promise<void> {
  const ok = await askDialog("Empty Trash?", `${formatCount(count, "Space")} will be deleted forever. Their folders move to your system trash; papers and projects stay where they are.`, "Empty trash", true);
  if (ok) end.post({ type: "emptyTrash" });
}

function menuButton(entries: () => MenuEntry[]): HTMLButtonElement {
  const button = renderElement("button", { class: "ls-icon-btn catalog-menu", type: "button", title: "Space actions", "aria-label": "Space actions", "aria-haspopup": "menu", html: renderIcon("more") });
  button.addEventListener("click", (event) => { event.stopPropagation(); showMenu(button, entries()); });
  return button;
}

function catalogRow(row: CatalogRow, end: SpacesTransport): HTMLElement {
  const article = renderElement("article", { class: "catalog-row" });
  if (row.unreadable !== undefined) {
    article.append(renderElement("div", { class: "catalog-main" },
      renderElement("strong", { text: row.name }),
      renderElement("p", { text: `spaces/${row.id}/space.json` }), renderElement("p", { text: row.unreadable })));
    return article;
  }
  const inTrash = row.place === "trash";
  const open = (tab: SpaceTab): void => { if (!inTrash) end.post({ type: "openSpace", id: row.id, tab }); };
  const title = renderElement("button", { class: "catalog-title", type: "button", title: row.name, text: row.name });
  title.addEventListener("click", (event) => { event.stopPropagation(); open("overview"); });
  article.addEventListener("click", () => open("overview"));
  const next = row.next
    ? cardItem("calendar", row.next.title, renderElement("time", { datetime: row.next.date, title: row.next.date, text: formatDay(row.next.date) }))
    : cardItem("calendar", "No upcoming dates", "Add one from the Space");
  const reading = cardItem("book-open", "Reading", renderElement("span", { class: "catalog-reading" },
    renderProgressMark(row.reading.done, row.reading.total), `${row.reading.done} / ${row.reading.total} Done`));
  if (inTrash) article.classList.add("in-trash");
  article.append(
    renderElement("div", { class: "catalog-top" },
      renderElement("span", { class: "catalog-icon", "aria-hidden": "true", html: renderIcon("layers") }),
      menuButton(() => spaceMenuEntries(row, end, () => open("overview")))),
    renderElement("div", { class: "catalog-main" }, title,
      renderElement("p", { text: row.purpose ?? "A personal place to read, collect ideas and explore." }),
      inTrash && row.trashedAt
        ? renderElement("div", { class: "catalog-members" }, renderElement("span", { "aria-hidden": "true", html: renderIcon("trash") }), `Moved to Trash ${formatDay(row.trashedAt.slice(0, 10))}`)
        : renderElement("div", { class: "catalog-members" }, renderElement("span", { "aria-hidden": "true", html: renderIcon("lock") }), "Only you")),
    renderElement("section", { class: "catalog-next", "aria-label": "Up next" }, renderElement("h3", { text: "Up next" }), next, reading),
    renderElement("div", { class: "catalog-links" },
      countLink(row.counts.papers, "paper", "book", () => open("papers")),
      countLink(row.counts.projects, "project", "folder", () => open("overview"))));
  return article;
}

async function createSpace(end: SpacesTransport, signal: AbortSignal): Promise<void> {
  const name = await askInputBox({ signal, title: "New Space", prompt: "Choose a topic, a course or a research question. Press Enter to create.", placeholder: "e.g. Thesis literature review", validate: (value) => value.trim() ? null : "Enter a Space name" });
  if (name && !signal.aborted) end.post({ type: "createSpace", name });
}

const PLACES: { id: SpacePlace; label: string }[] = [{ id: "spaces", label: "All Spaces" }, { id: "archived", label: "Archived" }, { id: "trash", label: "Trash" }];

type Filter = { text: string; place: CatalogFilter["place"] };

function emptyNotice(rows: readonly CatalogRow[], filter: Filter, create: () => void): HTMLElement {
  if (filter.text.trim()) return renderEmptyNotice({ text: "No matching Spaces.", hint: "Try another name or filter.", icon: "search" });
  if (filter.place === "archived") return renderEmptyNotice({ text: "No archived Spaces", hint: "Archive a Space to keep it out of the way.", icon: "layers" });
  if (filter.place === "trash") return renderEmptyNotice({ text: "Trash is empty", icon: "trash" });
  return renderEmptyNotice({ text: "No Spaces yet.", hint: "Create a Space to organise papers and projects around a topic.", icon: "layers",
    action: { label: "Create your first Space", primary: true, onClick: create } });
}

export function mountSpacesCatalog(root: HTMLElement, end: SpacesTransport): () => void {
  const lifecycle = new AbortController();
  let rows: readonly CatalogRow[] = [];
  const filter: Filter = { text: "", place: "spaces" };
  const list = renderElement("div", { class: "catalog-list" });
  const error = renderElement("div", { class: "catalog-error", role: "alert", hidden: true });
  const headerRow = renderElement("div", { class: "catalog-header" });
  const create = (): void => void createSpace(end, lifecycle.signal);
  const header = mountPlaceHeader<SpacePlace>(headerRow, {
    places: PLACES, ariaLabel: "Space places", placeholder: "Search Spaces", inputClass: "catalog-search",
    newLabel: "New Space", newTitle: "New Space", emptyTrashTitle: "Delete every Space in the Trash", withShare: true,
  }, {
    onPlace: (place) => { filter.place = place; render(); },
    onQuery: (text) => { filter.text = text; render(); },
    onNew: create,
    onEmptyTrash: () => void emptyTrash(countCatalogPlaces(rows).trash, end),
    // Spaces have no selection or sharing yet.
    onShare: () => { showToast("Still in implementation.", "info"); },
    onLeaveSearch: () => { const first = list.querySelector<HTMLElement>(".catalog-title"); if (first) first.focus(); else (document.activeElement as HTMLElement | null)?.blur(); },
  });
  const render = (): void => {
    const visible = deriveFilteredCatalogRows(rows, filter);
    header.paint(filter.place, countCatalogPlaces(rows), filter.text);
    list.replaceChildren(...(visible.length ? visible.map((row) => catalogRow(row, end)) : [emptyNotice(rows, filter, create)]));
  };
  const page = renderElement("div", { class: "catalog" }, renderPageHeading("Spaces"), headerRow, error, list,
    renderElement("p", { class: "catalog-hint", text: "Spaces group references. Papers stay in your Library." }));
  root.replaceChildren(page);
  const unsubscribe = end.subscribe((message) => {
    if (message.type === "catalog") { rows = message.rows; error.hidden = true; error.textContent = ""; render(); }
    else if (message.type === "error") { error.hidden = false; error.textContent = `${message.action}: ${message.message}`; }
  });
  render();
  end.post({ type: "ready", view: "catalog" });
  return () => { unsubscribe(); header.dispose(); lifecycle.abort(); page.remove(); };
}
