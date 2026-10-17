// Renders the All projects header: the place tabs as its title, the search box and the New project or Empty trash button.
import { escapeHtml, icon } from "../../../ui/index.js";
import type { ProjectPlace } from "../projectRow.js";

const SEARCH_DEBOUNCE_MS = 80;
const PLACES: { place: ProjectPlace; label: string }[] = [
  { place: "projects", label: "All projects" }, { place: "archived", label: "Archived" }, { place: "trash", label: "Trash" },
];

export interface HeaderHandlers {
  onPlace: (place: ProjectPlace) => void;
  onQuery: (query: string) => void;
  onNew: (anchor: HTMLElement) => void;
  onEmptyTrash: () => void;
  onToggleDetail: () => void;
  /** Moves focus from the search box to the rows. */
  onLeaveSearch: () => void;
}

export interface AllProjectsHeader {
  paint(place: ProjectPlace, counts: Record<ProjectPlace, number>, query: string): void;
}

const tabHtml = ({ place, label }: { place: ProjectPlace; label: string }): string =>
  `<button class="ls-place-tab" type="button" role="tab" data-place="${place}" aria-selected="false" tabindex="-1">` +
  `${escapeHtml(label)}<span class="ls-place-count"></span></button>`;

const headerHtml = (): string => `
  <div class="ls-place-tabs" role="tablist" aria-label="Project places">${PLACES.map(tabHtml).join("")}</div>
  <div class="ls-search">
    ${icon("search")}
    <input class="ls-all-projects-search" type="text" placeholder="Search projects" spellcheck="false" autocomplete="off" aria-label="Search projects"/>
    <kbd class="ls-search-key" aria-hidden="true">/</kbd>
    <button class="ls-search-clear" type="button" data-act="clear" title="Clear search (Esc)">${icon("x")}</button>
  </div>
  <button class="ls-btn ls-btn-ghost" type="button" data-act="new" title="New project">${icon("plus")}<span>New project</span></button>
  <button class="ls-btn ls-btn-ghost" type="button" data-act="empty-trash" title="Delete every project in the trash">${icon("trash")}<span>Empty trash</span></button>
  <button class="ls-icon-btn" type="button" data-act="detail" title="Toggle details panel">${icon("panel-right")}</button>`;

function wireSearch(search: HTMLInputElement, h: HeaderHandlers): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => h.onQuery(search.value), SEARCH_DEBOUNCE_MS);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { search.value = ""; h.onQuery(""); h.onLeaveSearch(); }
    else if (e.key === "ArrowDown" || e.key === "Enter") h.onLeaveSearch();
    else return;
    e.preventDefault();
  });
  // "/" focuses the search from anywhere outside a text field, as in the Library.
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (e.key !== "/" || e.metaKey || e.ctrlKey || target?.closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    search.focus();
  });
}

/** Left and Right move between the place tabs, which follow focus. */
function wireTabs(tabs: HTMLElement, h: HeaderHandlers): void {
  tabs.addEventListener("click", (e) => {
    const place = (e.target as HTMLElement).closest<HTMLElement>("[data-place]")?.dataset["place"] as ProjectPlace | undefined;
    if (place) h.onPlace(place);
  });
  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const at = PLACES.findIndex((p) => p.place === (e.target as HTMLElement).dataset["place"]);
    const next = PLACES[(at + (e.key === "ArrowRight" ? 1 : PLACES.length - 1)) % PLACES.length]!;
    h.onPlace(next.place);
    tabs.querySelector<HTMLElement>(`[data-place="${next.place}"]`)?.focus();
    e.preventDefault();
  });
}

export function mountAllProjectsHeader(container: HTMLElement, h: HeaderHandlers): AllProjectsHeader {
  container.innerHTML = headerHtml();
  const tabs = container.querySelector<HTMLElement>(".ls-place-tabs")!;
  const search = container.querySelector<HTMLInputElement>(".ls-all-projects-search")!;
  const searchBox = container.querySelector<HTMLElement>(".ls-search")!;
  const newBtn = container.querySelector<HTMLButtonElement>('[data-act="new"]')!;
  const emptyBtn = container.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!;
  wireSearch(search, h);
  wireTabs(tabs, h);
  newBtn.addEventListener("click", () => h.onNew(newBtn));
  emptyBtn.addEventListener("click", h.onEmptyTrash);
  container.querySelector('[data-act="detail"]')!.addEventListener("click", h.onToggleDetail);
  container.querySelector('[data-act="clear"]')!.addEventListener("click", () => { search.value = ""; h.onQuery(""); search.focus(); });
  return {
    paint(place, counts, query) {
      tabs.querySelectorAll<HTMLElement>("[data-place]").forEach((tab) => {
        const p = tab.dataset["place"] as ProjectPlace;
        tab.setAttribute("aria-selected", String(p === place));
        tab.tabIndex = p === place ? 0 : -1;
        tab.querySelector(".ls-place-count")!.textContent = String(counts[p]);
      });
      if (search.value !== query) search.value = query;
      searchBox.classList.toggle("has-query", query.length > 0);
      newBtn.hidden = place === "trash";
      emptyBtn.hidden = place !== "trash";
      emptyBtn.disabled = counts.trash === 0;
    },
  };
}
