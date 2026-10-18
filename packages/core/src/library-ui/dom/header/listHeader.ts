/**
 * Renders the list header: sidebar toggle, scope title with a match count while narrowed, search box, and toolbar (Add, details toggle).
 */
import { SYNTAX_HELP } from "../../../library/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { deriveScope } from "../../derive/index.js";
import { requestAddPaper } from "../flows/index.js";
import { togglePane } from "../shell/index.js";
import type { UiContext } from "../uiContext.js";
import { renderCrumbs } from "./breadcrumb.js";

const SEARCH_SYNTAX_TIP = SYNTAX_HELP.map((row) => `${row.syntax}   ${row.description}`).join("\n");
const SEARCH_DEBOUNCE_MS = 80;

const headerHtml = (addTooltip: string, readOnly: boolean): string => `
  <button class="ls-icon-btn sidebar-toggle" data-act="sidebar" title="Show library sidebar">${icon("panel-left")}</button>
  <nav class="breadcrumb" aria-label="List scope"></nav>
  <div class="ls-search" title="${escapeHtml(SEARCH_SYNTAX_TIP)}">
    ${icon("search")}
    <input class="ls-library-search" type="text" placeholder="Search papers" spellcheck="false" autocomplete="off" aria-label="Search papers"/>
    <kbd class="ls-search-key" aria-hidden="true">/</kbd>
    <button class="ls-search-clear" data-act="clear" title="Clear search (Esc)">${icon("x")}</button>
  </div>
  ${readOnly ? "" : `<button class="ls-btn ls-btn-ghost" data-act="add" title="${escapeHtml(addTooltip)}">${icon("plus")}<span>Add</span></button>`}
  <button class="ls-icon-btn" data-act="detail" title="Toggle details panel">${icon("panel-right")}</button>`;

function wireSearch(ctx: UiContext, search: HTMLInputElement): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctx.store.set({ query: search.value }), SEARCH_DEBOUNCE_MS);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { ctx.store.set({ query: "" }); search.value = ""; ctx.focusList(); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "Enter") {
      ctx.focusList();
      if (!ctx.store.get().cursor) ctx.cursor?.step(1, false);
      e.preventDefault();
    }
  });
}

function onToolbarClick(ctx: UiContext, act: string | undefined, search: HTMLInputElement): void {
  switch (act) {
    case "clear": ctx.store.set({ query: "" }); search.value = ""; search.focus(); return;
    case "add": requestAddPaper(ctx); return;
    case "detail": togglePane(ctx.root, ctx.prefs, "detail"); return;
    case "sidebar": togglePane(ctx.root, ctx.prefs, "sidebar"); return;
  }
}

/** Mounts the header and returns its unsubscribe function. */
export function mountListHeader(ctx: UiContext, container: HTMLElement): () => void {
  container.innerHTML = headerHtml(ctx.labels.addTooltip, ctx.readOnly);
  const search = container.querySelector<HTMLInputElement>(".ls-library-search")!;
  const searchBox = container.querySelector<HTMLElement>(".ls-search")!;
  const crumbs = container.querySelector<HTMLElement>(".breadcrumb")!;
  wireSearch(ctx, search);
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (btn) onToolbarClick(ctx, btn.dataset["act"], search);
  });
  return ctx.store.select(
    (s) => ({ folder: s.folder, papers: s.papers, query: s.query, pdfDirs: s.pdfDirs }),
    (slice) => {
      if (search.value !== slice.query) search.value = slice.query;
      searchBox.classList.toggle("has-query", slice.query.length > 0);
      const view = deriveScope(slice);
      const narrowed = slice.query.length > 0;
      renderCrumbs(ctx, crumbs, slice.folder, narrowed ? `${view.shown.length} / ${view.inFolder.length}` : "");
    },
  );
}
