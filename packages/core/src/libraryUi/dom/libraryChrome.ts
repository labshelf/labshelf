/**
 * The library UI's chrome: the frame with its sash, the list header with its Share button, and the column and paper menus.
 */
import { renderElement, showMenu, type MenuAnchor, type MenuEntry } from "../../ui/dom/index.js";
import { PANE_LIMITS, type PanePrefsPort, COLUMN_KEYS, type ListColumn } from "../store/index.js";
import { renderIcon, escapeHtml } from "../../ui/index.js";
import { createDebouncer } from "../../async/index.js";
import { SYNTAX_HELP, LIBRARY_LABEL, PAPERS_DIR, deriveBreadcrumb, isUnderDir, PAPER_STATUSES, STATUS_LABEL } from "../../library/index.js";
import { deriveScope, listPapersUnder, type ListPaper } from "../listModel.js";
import {
  sendAddPaperRequest, attachPdf, askFindBetterPdf, askRemove, copyCitation, findPdf, findFixablePapers, runHostFileAction, createTextLayer, openPaper, pickMoveFolder, askAddTags, setReadingStatus,
} from "./flows/index.js";
import { type UiContext, KEY_HINT } from "./uiContext.js";
import { attachDropZone } from "./paperDrag.js";
import { runShareFolderDialog } from "../../share/dom/index.js";
import { isPrePublication } from "../../model/index.js";

export interface FrameSlots {
  root: HTMLElement;
  /** Present when the host asked for a sidebar; the host fills it. */
  sidebar: HTMLElement | null;
  header: HTMLElement;
  list: HTMLElement;
  /** Present when the host asked for a citation map. */
  citationMap: HTMLElement | null;
}

const SIDEBAR_COLLAPSED_CLASS = "sidebar-collapsed";

function sidebarSash(root: HTMLElement, sidebar: HTMLElement, prefs: PanePrefsPort): HTMLElement {
  const sash = renderElement("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: SIDEBAR_COLLAPSED_CLASS, limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (width, collapsed) => prefs.save({ sidebarWidth: width, sidebarCollapsed: collapsed }),
  });
  return sash;
}

export interface FrameOptions {
  withSidebar: boolean;
  withCitationMap: boolean;
}

/** Builds the frame inside `host` and applies the saved sidebar width and collapsed state. */
export function buildFrame(host: HTMLElement, prefs: PanePrefsPort, options: FrameOptions): FrameSlots {
  const { withSidebar, withCitationMap } = options;
  const saved = prefs.load();
  const root = renderElement("div", { class: ["ls-library", ...(withSidebar ? ["has-sidebar"] : [])].join(" ") });
  const header = renderElement("div", { class: "list-header" });
  const list = renderElement("div", { class: "list-body" });
  const citationMap = withCitationMap ? renderElement("section", { class: "citation-map", "aria-label": "Citation map", hidden: true }) : null;
  const listPane = renderElement("section", { class: "list-pane" }, header, list, ...(citationMap ? [citationMap] : []));
  let sidebar: HTMLElement | null = null;
  if (withSidebar) {
    sidebar = renderElement("aside", { class: "sidebar", "aria-label": "Library" });
    sidebar.style.width = `${saved.sidebarWidth}px`;
    root.classList.toggle(SIDEBAR_COLLAPSED_CLASS, saved.sidebarCollapsed);
    root.append(sidebar, sidebarSash(root, sidebar, prefs));
  }
  root.append(listPane);
  host.append(root);
  return { root, sidebar, header, list, citationMap };
}

/** Toggles the sidebar and saves the new state; returns whether it is now collapsed. */
function updateSidebarOpen(root: HTMLElement, prefs: PanePrefsPort): boolean {
  const collapsed = root.classList.toggle(SIDEBAR_COLLAPSED_CLASS);
  prefs.save({ sidebarCollapsed: collapsed });
  return collapsed;
}

export interface SashOptions {
  root: HTMLElement;
  pane: HTMLElement;
  collapsedClass: string;
  limits: { min: number; max: number; collapseAt: number };
  widthFromPointer: (clientX: number) => number;
  persist: (width: number, collapsed: boolean) => void;
  /** The width a double-click returns to; without it a double-click only restores a collapsed pane. */
  defaultWidth?: number;
}

/** Wires one sash. The sash captures the pointer so a drag over an iframe still ends with the button. */
export function attachSash(sash: HTMLElement, o: SashOptions): void {
  sash.insertAdjacentHTML("afterbegin", `<span class="ls-sash-grip" aria-hidden="true">${renderIcon("more")}</span>`);
  let dragging = false;
  const width = (): number => parseInt(o.pane.style.width, 10) || o.limits.min;
  sash.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || dragging) return;
    dragging = true;
    sash.setPointerCapture(e.pointerId);
    sash.classList.add("dragging");
    o.root.classList.add("resizing");
    e.preventDefault();
  });
  sash.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const desired = o.widthFromPointer(e.clientX);
    if (desired < o.limits.collapseAt) { o.root.classList.add(o.collapsedClass); return; }
    o.root.classList.remove(o.collapsedClass);
    o.pane.style.width = `${Math.min(o.limits.max, Math.max(o.limits.min, desired))}px`;
  });
  // Releasing capture fires lostpointercapture, so every way a drag ends reaches the same handler.
  const end = (): void => {
    if (!dragging) return;
    dragging = false;
    sash.classList.remove("dragging");
    o.root.classList.remove("resizing");
    o.persist(width(), o.root.classList.contains(o.collapsedClass));
  };
  sash.addEventListener("pointerup", end);
  sash.addEventListener("pointercancel", end);
  sash.addEventListener("lostpointercapture", end);
  sash.addEventListener("dblclick", () => {
    o.root.classList.remove(o.collapsedClass);
    if (o.defaultWidth) o.pane.style.width = `${o.defaultWidth}px`;
    o.persist(width(), false);
  });
}

function crumb(ctx: UiContext, label: string, path: string, last: boolean): HTMLElement {
  const b = renderElement("button", {
    class: `crumb${last ? " current" : ""}`,
    type: "button",
    title: last ? label : `Go to ${label}`,
    html: `<span>${escapeHtml(label)}</span>`,
  });
  if (!last) {
    b.addEventListener("click", () => ctx.store.openFolder(path));
    attachDropZone(ctx, b, path);
  }
  return b;
}

function renderCrumbs(ctx: UiContext, container: HTMLElement, folder: string, count: string): void {
  const chain = deriveBreadcrumb(PAPERS_DIR, folder, "/");
  const frag = document.createDocumentFragment();
  if (chain.length === 1) {
    frag.append(crumb(ctx, LIBRARY_LABEL, PAPERS_DIR, true));
  } else {
    chain.forEach((node, i) => {
      if (i > 0) frag.append(renderElement("span", { class: "crumb-sep", html: renderIcon("chevron-right") }));
      frag.append(crumb(ctx, node.isRoot ? LIBRARY_LABEL : node.label, node.path, i === chain.length - 1));
    });
  }
  frag.append(renderElement("span", { class: "ls-count", text: count }));
  container.replaceChildren(frag);
}

const SEARCH_SYNTAX_TIP = SYNTAX_HELP.map((row) => `${row.syntax}   ${row.description}`).join("\n");
const SEARCH_DEBOUNCE_MS = 80;

const headerHtml = (addTooltip: string, readOnly: boolean): string => `
  <button class="ls-icon-btn sidebar-toggle" data-act="sidebar" title="Show library sidebar">${renderIcon("panel-left")}</button>
  <nav class="breadcrumb" aria-label="List scope"></nav>
  <div class="ls-search" title="${escapeHtml(SEARCH_SYNTAX_TIP)}">
    ${renderIcon("search")}
    <input class="ls-library-search" type="text" placeholder="Search papers" spellcheck="false" autocomplete="off" aria-label="Search papers"/>
    <kbd class="ls-search-key" aria-hidden="true">/</kbd>
    <button class="ls-search-clear" data-act="clear" title="Clear search (Esc)">${renderIcon("x")}</button>
  </div>
  ${readOnly ? "" : `<button class="ls-btn ls-btn-ghost" data-act="add" title="${escapeHtml(addTooltip)}">${renderIcon("plus")}<span>Add</span></button>`}`;

function wireSearch(ctx: UiContext, search: HTMLInputElement): void {
  const applyQuery = createDebouncer(() => ctx.store.set({ query: search.value }), SEARCH_DEBOUNCE_MS);
  search.addEventListener("input", () => applyQuery.call());
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
    case "add": sendAddPaperRequest(ctx); return;
    case "sidebar": updateSidebarOpen(ctx.root, ctx.prefs); return;
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
  const offShare = mountShareFolderButton(ctx, container);
  const offScope = ctx.store.select(
    (s) => ({ folder: s.folder, papers: s.papers, query: s.query, pdfDirs: s.pdfDirs }),
    (slice) => {
      if (search.value !== slice.query) search.value = slice.query;
      searchBox.classList.toggle("has-query", slice.query.length > 0);
      const view = deriveScope(slice);
      const narrowed = slice.query.length > 0;
      renderCrumbs(ctx, crumbs, slice.folder, narrowed ? `${view.shown.length} / ${view.inFolder.length}` : "");
    },
  );
  return () => { offShare(); offScope(); };
}

/** Appends the button to `container` and keeps it in step with the folder and the host's offers; returns the unsubscribe. */
function mountShareFolderButton(ctx: UiContext, container: HTMLElement): () => void {
  const sharing = ctx.sharing;
  if (ctx.readOnly || !sharing) return () => undefined;
  let button: HTMLElement | null = null;
  let folder = ctx.store.get().folder;
  const paint = (): void => {
    const shown = sharing.offers().links && folder !== PAPERS_DIR && isUnderDir(folder, PAPERS_DIR, "/");
    if (!shown) { button?.remove(); button = null; return; }
    const name = folder.split("/").pop() ?? folder;
    if (!button) {
      button = renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", html: `${renderIcon("link")}<span>Share</span>` });
      button.dataset["act"] = "share";
      button.addEventListener("click", () => void runShareFolderDialog(sharing, folder));
      container.append(button);
    }
    button.setAttribute("aria-label", `Share "${name}" as a link`);
  };
  const offFolder = ctx.store.select((s) => s.folder, (next) => { folder = next; paint(); });
  const offOffers = sharing.onOffersChange(paint);
  return () => { offFolder(); offOffers(); };
}

const LABEL: Record<ListColumn, string> = { creator: "Authors", venue: "Venue", year: "Year", lastRead: "Last read", status: "Status" };

function toggleColumn(ctx: UiContext, key: ListColumn): void {
  const s = ctx.store.get();
  const columns = COLUMN_KEYS.filter((k) => (k === key) !== s.columns.includes(k));
  // A hidden column cannot stay the sort, since nothing on screen shows the order.
  const patch = s.sortKey === key && !columns.includes(key) ? { columns, sortKey: "title" as const, sortDir: 1 as const } : { columns };
  ctx.prefs.save(patch);
  ctx.store.set(patch);
}

/** Opens the columns menu at a point or under an element. */
export function showColumnsMenu(ctx: UiContext, at: MenuAnchor | HTMLElement): void {
  const shown = ctx.store.get().columns;
  showMenu(at, COLUMN_KEYS.map((key) => ({ label: LABEL[key], checked: shown.includes(key), onSelect: () => toggleColumn(ctx, key) })));
}

function openEntries(ctx: UiContext, p: ListPaper): MenuEntry[] {
  const lastPage = ctx.store.get().stats[p.id]?.lastPage ?? 0;
  const entries: MenuEntry[] = [{
    icon: "book-open", label: lastPage > 1 ? `Continue Reading (p. ${lastPage})` : "Open PDF", hint: "Enter",
    disabled: !p.hasPdf, onSelect: () => openPaper(ctx, p.id),
  }];
  if (ctx.caps.openExternal) entries.push({ icon: "external", label: "Open in Default PDF App", disabled: !p.hasPdf, onSelect: () => runHostFileAction(ctx, "paper.openExternal", p.id) });
  if (ctx.caps.findPdf && !p.hasPdf) entries.push({ icon: "search", label: "Find PDF", onSelect: () => findPdf(ctx, p.id) });
  if (ctx.caps.findPdf && p.hasPdf && isPrePublication(p.pdfVersion)) {
    entries.push({ icon: "search", label: "Find Published Version…", onSelect: () => { void askFindBetterPdf(ctx, p.id); } });
  }
  if (ctx.caps.attachPdf) entries.push({ icon: "paperclip", label: "Attach PDF…", onSelect: () => attachPdf(ctx, p.id) });
  return [...entries, "separator"];
}

function copyEntries(ctx: UiContext, ids: string[]): MenuEntry[] {
  return [
    { icon: "key", label: ids.length > 1 ? `Copy ${ids.length} Cite Keys` : "Copy Cite Key", hint: `${KEY_HINT.mod}C`, onSelect: () => copyCitation(ctx, ids, "key") },
    { icon: "quote", label: "Copy BibTeX", onSelect: () => copyCitation(ctx, ids, "bibtex") },
    { label: "Copy APA Reference", onSelect: () => copyCitation(ctx, ids, "apa") },
    "separator",
  ];
}

function statusEntries(ctx: UiContext, ids: string[]): MenuEntry[] {
  const byId = new Map(ctx.store.get().papers.map((p) => [p.id, p]));
  return [...PAPER_STATUSES.map((status, i): MenuEntry => ({
    lead: `<span class="ls-dot s-${status}"></span>`,
    checked: ids.every((id) => byId.get(id)?.status === status),
    label: `Mark as ${STATUS_LABEL[status]}`,
    hint: `${KEY_HINT.alt}${i + 1}`,
    onSelect: () => setReadingStatus(ctx, ids, status),
  })), "separator"];
}

function organizeEntries(ctx: UiContext, ids: string[], one: ListPaper | null): MenuEntry[] {
  const entries: MenuEntry[] = [];
  entries.push({ icon: "tag", label: ids.length > 1 ? `Tag ${ids.length} Papers…` : "Add Tag…", onSelect: () => { void askAddTags(ctx, ids); } });
  entries.push({ icon: "folder-move", label: "Move to…", onSelect: () => { void pickMoveFolder(ctx, ids); } });
  if (ctx.caps.spaces) entries.push({ icon: "folder", label: "Add to Space…", onSelect: () => ctx.transport.post({ type: "paper.addToSpace", ids }) });
  if (one && ctx.caps.reveal) entries.push({ icon: "folder", label: ctx.labels.revealPaper ?? "Reveal Folder", onSelect: () => runHostFileAction(ctx, "paper.reveal", one.id) });
  const fix = ctx.caps.textLayer ? findFixablePapers(ctx, ids) : [];
  if (fix.length) entries.push({ icon: "file-no-text", label: ids.length > 1 ? `Make ${fix.length} Searchable` : "Make Searchable (OCR)", onSelect: () => createTextLayer(ctx, fix) });
  if (one && ctx.caps.fetchMetadata) entries.push({ icon: "refresh", label: "Fetch Metadata Online", onSelect: () => runHostFileAction(ctx, "paper.fetchMetadata", one.id) });
  if (one && (ctx.store.get().stats[one.id]?.annotations ?? 0) > 0) {
    entries.push({ icon: "download", label: "Export Annotations…", onSelect: () => runHostFileAction(ctx, "annotations.export", one.id) });
  }
  return [...entries, "separator"];
}

function paperMenuEntries(ctx: UiContext, ids: string[]): MenuEntry[] {
  const s = ctx.store.get();
  const one = ids.length === 1 ? listPapersUnder(s.papers, PAPERS_DIR, s.pdfDirs).find((p) => p.id === ids[0]) ?? null : null;
  return [
    ...(one ? openEntries(ctx, one) : []),
    ...copyEntries(ctx, ids),
    ...statusEntries(ctx, ids),
    ...organizeEntries(ctx, ids, one),
    {
      icon: "trash", danger: true, label: ids.length > 1 ? `Remove ${ids.length} Papers…` : "Remove from Library…", hint: KEY_HINT.remove,
      onSelect: () => { void askRemove(ctx, ids); },
    },
  ];
}

export function showPaperMenu(ctx: UiContext, at: MenuAnchor | HTMLElement, onClose?: () => void): void {
  const ids = [...ctx.store.get().selected];
  if (ids.length > 0) showMenu(at, paperMenuEntries(ctx, ids), onClose ? { onClose } : {});
}
