// The place header the Library, All projects and All Spaces pages share: place tabs with counts, a soft search well, Share, New and Empty trash buttons.
import { createDebouncer } from "../../../async/index.js";
import { renderIcon } from "../../icons/index.js";
import { escapeHtml } from "../../htmlSafety.js";

const SEARCH_DEBOUNCE_MS = 80;

export interface PlaceHeaderOptions<P extends string> {
  /** The tabs in order; the place with id "trash" owns the Empty trash button. */
  places: readonly { id: P; label: string }[];
  ariaLabel: string;
  placeholder: string;
  /** The class of the search input, for hosts that find or style it. */
  inputClass: string;
  newLabel: string;
  newTitle: string;
  emptyTrashTitle: string;
  /** Nodes placed before the tabs, such as the Library's sidebar toggle. */
  leading?: readonly HTMLElement[];
  /** The search box's tooltip, such as the search syntax. */
  searchTitle?: string;
  /** Renders the New button; defaults to true. */
  withNew?: boolean;
  /** Renders a ghost Share button before New, hidden in Trash; clicks go to `onShare`. */
  withShare?: boolean;
  /** Lets "/" focus the search from anywhere; defaults to true. Off when the host already binds the key. */
  slashKey?: boolean;
}

export interface PlaceHeaderHandlers<P extends string> {
  onPlace: (place: P) => void;
  onQuery: (query: string) => void;
  onNew: (anchor: HTMLElement) => void;
  onEmptyTrash: () => void;
  /** Moves focus from the search box to the rows; `key` is the key that left it (Escape, ArrowDown or Enter). */
  onLeaveSearch: (key: string) => void;
  onShare?: (anchor: HTMLElement) => void;
}

export interface PlaceHeader<P extends string> {
  paint(place: P, counts: Record<P, number>, query: string): void;
  /** Updates the Share button, when there is one; `title` says why it is disabled. */
  setShare(state: { disabled: boolean; title: string }): void;
  /** Removes the document listener the "/" key needs. */
  dispose(): void;
}

const tabHtml = ({ id, label }: { id: string; label: string }): string =>
  `<button class="ls-place-tab" type="button" role="tab" data-place="${escapeHtml(id)}" aria-selected="false" tabindex="-1">` +
  `${escapeHtml(label)}<span class="ls-place-count"></span></button>`;

function headerHtml(o: PlaceHeaderOptions<string>): string {
  return `
  <div class="ls-place-tabs" role="tablist" aria-label="${escapeHtml(o.ariaLabel)}">${o.places.map(tabHtml).join("")}</div>
  <div class="ls-search"${o.searchTitle ? ` title="${escapeHtml(o.searchTitle)}"` : ""}>
    ${renderIcon("search")}
    <input class="${escapeHtml(o.inputClass)}" type="text" placeholder="${escapeHtml(o.placeholder)}" spellcheck="false" autocomplete="off" aria-label="${escapeHtml(o.placeholder)}"/>
    <kbd class="ls-search-key" aria-hidden="true">/</kbd>
    <button class="ls-search-clear" type="button" data-act="clear" title="Clear search (Esc)">${renderIcon("x")}</button>
  </div>
  ${o.withShare ? `<button class="ls-btn ls-btn-ghost" type="button" data-act="share" title="Share">${renderIcon("link")}<span>Share</span></button>` : ""}
  ${o.withNew === false ? "" : `<button class="ls-btn ls-btn-ghost" type="button" data-act="new" title="${escapeHtml(o.newTitle)}">${renderIcon("plus")}<span>${escapeHtml(o.newLabel)}</span></button>`}
  <button class="ls-btn ls-btn-ghost" type="button" data-act="empty-trash" title="${escapeHtml(o.emptyTrashTitle)}">${renderIcon("trash")}<span>Empty trash</span></button>`;
}

function wireSearch<P extends string>(search: HTMLInputElement, h: PlaceHeaderHandlers<P>, signal: AbortSignal, slashKey: boolean): () => void {
  const applyQuery = createDebouncer(() => h.onQuery(search.value), SEARCH_DEBOUNCE_MS);
  search.addEventListener("input", () => applyQuery.call());
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { applyQuery.cancel(); search.value = ""; h.onQuery(""); h.onLeaveSearch(e.key); }
    else if (e.key === "ArrowDown" || e.key === "Enter") h.onLeaveSearch(e.key);
    else return;
    e.preventDefault();
  });
  if (!slashKey) return () => applyQuery.cancel();
  // "/" focuses the search from anywhere outside a text field, as in the Library.
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (e.key !== "/" || e.metaKey || e.ctrlKey || target?.closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    search.focus();
  }, { signal });
  return () => applyQuery.cancel();
}

/** Left and Right move between the place tabs, which follow focus. */
function wireTabs<P extends string>(tabs: HTMLElement, places: readonly { id: P }[], h: PlaceHeaderHandlers<P>): void {
  tabs.addEventListener("click", (e) => {
    const place = (e.target as HTMLElement).closest<HTMLElement>("[data-place]")?.dataset["place"] as P | undefined;
    if (place) h.onPlace(place);
  });
  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const at = places.findIndex((p) => p.id === (e.target as HTMLElement).dataset["place"]);
    const next = places[(at + (e.key === "ArrowRight" ? 1 : places.length - 1)) % places.length]!;
    h.onPlace(next.id);
    tabs.querySelector<HTMLElement>(`[data-place="${next.id}"]`)?.focus();
    e.preventDefault();
  });
}

/** Fills `container` with the header and returns its painter; hosts own the state and call `paint` after every change. */
export function mountPlaceHeader<P extends string>(container: HTMLElement, o: PlaceHeaderOptions<P>, h: PlaceHeaderHandlers<P>): PlaceHeader<P> {
  container.classList.add("ls-place-header");
  container.innerHTML = headerHtml(o);
  container.prepend(...(o.leading ?? []));
  const lifecycle = new AbortController();
  const tabs = container.querySelector<HTMLElement>(".ls-place-tabs")!;
  const search = container.querySelector<HTMLInputElement>(`input.${o.inputClass}`)!;
  const searchBox = container.querySelector<HTMLElement>(".ls-search")!;
  const newBtn = container.querySelector<HTMLButtonElement>('[data-act="new"]');
  const shareBtn = container.querySelector<HTMLButtonElement>('[data-act="share"]');
  const emptyBtn = container.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!;
  const cancelQuery = wireSearch(search, h, lifecycle.signal, o.slashKey !== false);
  wireTabs(tabs, o.places, h);
  newBtn?.addEventListener("click", () => h.onNew(newBtn));
  shareBtn?.addEventListener("click", () => h.onShare?.(shareBtn));
  emptyBtn.addEventListener("click", h.onEmptyTrash);
  container.querySelector('[data-act="clear"]')!.addEventListener("click", () => { search.value = ""; h.onQuery(""); search.focus(); });
  return {
    paint(place, counts, query) {
      tabs.querySelectorAll<HTMLElement>("[data-place]").forEach((tab) => {
        const p = tab.dataset["place"] as P;
        tab.setAttribute("aria-selected", String(p === place));
        tab.tabIndex = p === place ? 0 : -1;
        tab.querySelector(".ls-place-count")!.textContent = String(counts[p]);
      });
      if (search.value !== query) search.value = query;
      searchBox.classList.toggle("has-query", query.length > 0);
      if (newBtn) newBtn.hidden = place === "trash";
      if (shareBtn) shareBtn.hidden = place === "trash";
      emptyBtn.hidden = place !== "trash";
      emptyBtn.disabled = (counts as Record<string, number>)["trash"] === 0;
    },
    setShare({ disabled, title }) {
      if (!shareBtn) return;
      shareBtn.disabled = disabled;
      shareBtn.title = title;
    },
    dispose() { lifecycle.abort(); cancelQuery(); },
  };
}
