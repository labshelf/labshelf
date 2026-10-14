/**
 * The list header: the sidebar toggle, the folder path with its count, the search box, and the toolbar (subfolder
 * toggle, new subfolder, Add, details toggle).
 */
import { PAPERS_DIR, SYNTAX_HELP, subfoldersOf } from "../../../library/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { deriveScope } from "../../derive/index.js";
import { promptNewFolder, requestAddPaper } from "../flows/index.js";
import { togglePane } from "../shell/index.js";
import type { UiContext } from "../uiContext.js";
import { renderCrumbs } from "./breadcrumb.js";

const SEARCH_SYNTAX_TIP = SYNTAX_HELP.map((row) => `${row.syntax}   ${row.description}`).join("\n");
const SEARCH_DEBOUNCE_MS = 80;

const headerHtml = (addTooltip: string): string => `
  <button class="ls-icon-btn sidebar-toggle" data-act="sidebar" title="Show library sidebar">${icon("panel-left")}</button>
  <nav class="breadcrumb" aria-label="Folder path"></nav>
  <div class="ls-search" title="${escapeHtml(SEARCH_SYNTAX_TIP)}">
    ${icon("search")}
    <input class="ls-library-search" type="text" placeholder="Search title, author, year, keyword  ( / )" spellcheck="false" autocomplete="off" aria-label="Search papers"/>
    <button class="ls-search-clear" data-act="clear" title="Clear search (Esc)">${icon("x")}</button>
  </div>
  <button class="ls-icon-btn" data-act="includeSub" title="Show papers from subfolders">${icon("layers")}</button>
  <button class="ls-icon-btn" data-act="newFolder" title="New subfolder">${icon("folder-plus")}</button>
  <button class="ls-btn ls-btn-primary" data-act="add" title="${escapeHtml(addTooltip)}">${icon("plus")}<span>Add</span></button>
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
    case "includeSub": {
      const includeSub = !ctx.store.get().includeSub;
      ctx.prefs.save({ includeSub });
      ctx.store.set({ includeSub });
      return;
    }
    case "newFolder": void promptNewFolder(ctx, ctx.store.get().folder); return;
    case "add": requestAddPaper(ctx); return;
    case "detail": togglePane(ctx.root, ctx.prefs, "detail"); return;
    case "sidebar": togglePane(ctx.root, ctx.prefs, "sidebar"); return;
  }
}

/** Mounts the header and returns its unsubscribe function. */
export function mountListHeader(ctx: UiContext, container: HTMLElement): () => void {
  container.innerHTML = headerHtml(ctx.labels.addTooltip);
  const search = container.querySelector<HTMLInputElement>(".ls-library-search")!;
  const searchBox = container.querySelector<HTMLElement>(".ls-search")!;
  const includeSubBtn = container.querySelector<HTMLElement>('[data-act="includeSub"]')!;
  const crumbs = container.querySelector<HTMLElement>(".breadcrumb")!;
  wireSearch(ctx, search);
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (btn) onToolbarClick(ctx, btn.dataset["act"], search);
  });
  return ctx.store.select(
    (s) => ({ folder: s.folder, folders: s.folders, papers: s.papers, query: s.query, status: s.status, noText: s.noText, includeSub: s.includeSub, pdfDirs: s.pdfDirs }),
    (slice) => {
      if (search.value !== slice.query) search.value = slice.query;
      searchBox.classList.toggle("has-query", slice.query.length > 0);
      includeSubBtn.classList.toggle("active", slice.includeSub);
      includeSubBtn.setAttribute("aria-pressed", String(slice.includeSub));
      // The toggle has nothing to show in a folder without subfolders.
      includeSubBtn.hidden = subfoldersOf(slice.folders, slice.folder, PAPERS_DIR, []).length === 0;
      const view = deriveScope(slice);
      const narrowed = slice.query.length > 0 || slice.status !== "all" || slice.noText;
      renderCrumbs(ctx, crumbs, slice.folder, narrowed ? `${view.shown.length} / ${view.inFolder.length}` : view.scope.length ? String(view.scope.length) : "");
    },
  );
}
