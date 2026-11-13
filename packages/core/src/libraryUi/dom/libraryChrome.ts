/**
 * The library UI's chrome: the frame with its sash, the list header with its places and Share menu, and the column and paper menus.
 */
import { renderElement, renderPageHeading, showMenu, showToast, mountPlaceHeader, type MenuAnchor, type MenuEntry } from "../../ui/dom/index.js";
import { DEFAULT_PREFS, PANE_LIMITS, type PanePrefsPort, COLUMN_KEYS, type ListColumn, type LibraryPlace, listPlacePapers } from "../store/index.js";
import { renderIcon, escapeHtml } from "../../ui/index.js";
import { SYNTAX_HELP, LIBRARY_LABEL, PAPERS_DIR, deriveBreadcrumb, isUnderDir, PAPER_STATUSES, STATUS_LABEL } from "../../library/index.js";
import { deriveScope, listPapersUnder, type ListPaper } from "../listModel.js";
import {
  sendAddPaperRequest, attachPdf, askFindBetterPdf, askRemove, askEmptyTrash, trashPapers, restorePapers, copyCitation, findPdf, findFixablePapers, runHostFileAction, createTextLayer, openPaper, pickMoveFolder, askAddTags, setReadingStatus,
} from "./flows/index.js";
import { type UiContext, KEY_HINT } from "./uiContext.js";
import { attachDropZone } from "./paperDrag.js";
import { runShareFolderDialog } from "../../share/dom/index.js";
import type { ShareHost } from "../../share/index.js";
import { isPrePublication } from "../../model/index.js";

export interface FrameSlots {
  root: HTMLElement;
  /** Present when the host asked for a sidebar; the host fills it. */
  sidebar: HTMLElement | null;
  /** The page name in the heading; the Library shows its folder path there. */
  heading: HTMLElement;
  header: HTMLElement;
  list: HTMLElement;
  /** Present when the host asked for a citation map. */
  citationMap: HTMLElement | null;
  /** Present when the host asked for a detail pane: the resizable column right of the list; the page fills it. */
  detail: HTMLElement | null;
}

const SIDEBAR_COLLAPSED_CLASS = "sidebar-collapsed";
const DETAIL_COLLAPSED_CLASS = "detail-collapsed";

function sidebarSash(root: HTMLElement, sidebar: HTMLElement, prefs: PanePrefsPort): HTMLElement {
  const sash = renderElement("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: SIDEBAR_COLLAPSED_CLASS, limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (width, collapsed) => prefs.save({ sidebarWidth: width, sidebarCollapsed: collapsed }),
  });
  return sash;
}

function detailSash(root: HTMLElement, detail: HTMLElement, prefs: PanePrefsPort): HTMLElement {
  const sash = renderElement("div", { class: "sash sash-detail", title: "Drag to resize" });
  attachSash(sash, {
    root, pane: detail, collapsedClass: DETAIL_COLLAPSED_CLASS, limits: PANE_LIMITS.detail,
    widthFromPointer: (x) => root.getBoundingClientRect().right - x,
    persist: (width, collapsed) => prefs.save({ detailWidth: width, detailCollapsed: collapsed }),
    defaultWidth: DEFAULT_PREFS.detailWidth,
  });
  return sash;
}

export interface FrameOptions {
  withSidebar: boolean;
  withCitationMap: boolean;
  /** Adds a resizable detail pane right of the list. */
  withDetail?: boolean;
  /** The page name shown in the heading above the list header. */
  title: string;
}

/** Builds the frame inside `host` and applies the saved sidebar width and collapsed state. */
export function buildFrame(host: HTMLElement, prefs: PanePrefsPort, options: FrameOptions): FrameSlots {
  const { withSidebar, withCitationMap, title } = options;
  const saved = prefs.load();
  const root = renderElement("div", { class: ["ls-library", ...(withSidebar ? ["has-sidebar"] : [])].join(" ") });
  const pageHeading = renderPageHeading(title);
  const heading = pageHeading.querySelector("h1")!;
  const header = renderElement("div", { class: "list-header" });
  const list = renderElement("div", { class: "list-body" });
  const citationMap = withCitationMap ? renderElement("section", { class: "citation-map", "aria-label": "Citation map", hidden: true }) : null;
  const listPane = renderElement("section", { class: "list-pane" }, pageHeading, header, list, ...(citationMap ? [citationMap] : []));
  let sidebar: HTMLElement | null = null;
  if (withSidebar) {
    sidebar = renderElement("aside", { class: "sidebar", "aria-label": "Library" });
    sidebar.style.width = `${saved.sidebarWidth}px`;
    root.classList.toggle(SIDEBAR_COLLAPSED_CLASS, saved.sidebarCollapsed);
    root.append(sidebar, sidebarSash(root, sidebar, prefs));
  }
  root.append(listPane);
  let detail: HTMLElement | null = null;
  if (options.withDetail) {
    detail = renderElement("div", { class: "ls-details ls-tab-details" });
    detail.style.width = `${saved.detailWidth ?? DEFAULT_PREFS.detailWidth}px`;
    root.classList.add("has-detail");
    root.classList.toggle(DETAIL_COLLAPSED_CLASS, saved.detailCollapsed ?? false);
    root.append(detailSash(root, detail, prefs), detail);
  }
  host.append(root);
  return { root, sidebar, heading, header, list, citationMap, detail };
}

/** The header button that shows or hides a frame's detail pane, and saves that. */
export function renderDetailToggle(root: HTMLElement, prefs: PanePrefsPort): HTMLElement {
  const button = renderElement("button", { class: "ls-icon-btn detail-toggle", type: "button", title: "Toggle details panel", "aria-label": "Toggle details panel", html: renderIcon("panel-right") });
  button.addEventListener("click", () => { prefs.save({ detailCollapsed: root.classList.toggle(DETAIL_COLLAPSED_CLASS) }); });
  return button;
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

function crumb(ctx: UiContext, label: string, path: string, last: boolean, root: boolean): HTMLElement {
  const b = renderElement("button", {
    class: `crumb${last ? " current" : ""}${root ? " crumb-root" : ""}`,
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
    frag.append(crumb(ctx, LIBRARY_LABEL, PAPERS_DIR, true, true));
  } else {
    chain.forEach((node, i) => {
      if (i > 0) frag.append(renderElement("span", { class: "crumb-sep", "aria-hidden": "true", text: "/" }));
      frag.append(crumb(ctx, node.isRoot ? LIBRARY_LABEL : node.label, node.path, i === chain.length - 1, node.isRoot));
    });
  }
  frag.append(renderElement("span", { class: "ls-count", text: count }));
  container.replaceChildren(frag);
}

const SEARCH_SYNTAX_TIP = SYNTAX_HELP.map((row) => `${row.syntax}   ${row.description}`).join("\n");
const IN_IMPLEMENTATION = "Still in implementation.";

const PLACES: { id: LibraryPlace; label: string }[] = [{ id: "papers", label: "All papers" }, { id: "trash", label: "Trash" }];

function sidebarToggle(ctx: UiContext): HTMLElement {
  const button = renderElement("button", { class: "ls-icon-btn sidebar-toggle", type: "button", title: "Show library sidebar", html: renderIcon("panel-left") });
  button.addEventListener("click", () => updateSidebarOpen(ctx.root, ctx.prefs));
  return button;
}

/** Why the current folder cannot be shared as a link, or null when it can; the rule the folder Share entry follows. */
function folderShareBlocker(sharing: ShareHost, folder: string): string | null {
  if (!sharing.offers().links) return "Sharing links are not available here";
  if (folder === PAPERS_DIR || !isUnderDir(folder, PAPERS_DIR, "/")) return "Open a folder to share it";
  return null;
}

/** The Share menu: the current folder through the folder share dialog, and the selected paper, which is not built yet. */
function showShareMenu(ctx: UiContext, sharing: ShareHost, anchor: HTMLElement): void {
  const { folder, selected } = ctx.store.get();
  const folderBlocker = folderShareBlocker(sharing, folder);
  const name = folder.split("/").pop() ?? folder;
  showMenu(anchor, [
    {
      icon: "folder", label: "Share folder…", disabled: folderBlocker !== null, title: folderBlocker ?? `Share "${name}" as a link`,
      onSelect: () => void runShareFolderDialog(sharing, folder),
    },
    {
      icon: "file-text", label: "Share selected paper…", disabled: selected.size !== 1, ...(selected.size !== 1 ? { title: "Select one paper to share" } : {}),
      onSelect: () => { showToast(IN_IMPLEMENTATION, "info"); },
    },
  ]);
}

/** Fills the list header with the shared place header and shows the folder path in `heading`, the page title: Library large, the folders after it smaller; `trailing` goes after the buttons. Returns the unmount. */
export function mountListHeader(ctx: UiContext, container: HTMLElement, heading: HTMLElement, trailing: readonly HTMLElement[] = []): () => void {
  const sharing = ctx.readOnly ? undefined : ctx.sharing;
  const header = mountPlaceHeader<LibraryPlace>(container, {
    places: PLACES, ariaLabel: "Library places", placeholder: "Search papers", inputClass: "ls-library-search",
    newLabel: "Add", newTitle: ctx.labels.addTooltip, emptyTrashTitle: "Delete every paper in the trash",
    leading: [sidebarToggle(ctx)], trailing, searchTitle: SEARCH_SYNTAX_TIP, withNew: !ctx.readOnly, withShare: !!sharing,
    // The list's own shortcuts bind "/" and select the query text.
    slashKey: false,
  }, {
    onPlace: (place) => ctx.store.setPlace(place),
    onQuery: (query) => ctx.store.set({ query }),
    onNew: () => sendAddPaperRequest(ctx),
    onEmptyTrash: () => { void askEmptyTrash(ctx); },
    onLeaveSearch: (key) => {
      ctx.focusList();
      if (key !== "Escape" && !ctx.store.get().cursor) ctx.cursor?.step(1, false);
    },
    ...(sharing ? { onShare: (anchor: HTMLElement) => showShareMenu(ctx, sharing, anchor) } : {}),
  });
  heading.classList.add("breadcrumb");
  const paint = (): void => {
    const s = ctx.store.get();
    const view = deriveScope(s);
    const papers = s.place === "papers" ? view.inFolder.length : deriveScope({ ...s, place: "papers" }).inFolder.length;
    header.paint(s.place, { papers, trash: s.trashed.length }, s.query);
    renderCrumbs(ctx, heading, s.folder, s.query.length > 0 ? `${view.shown.length} / ${view.inFolder.length}` : "");
  };
  const offScope = ctx.store.select((s) => ({ folder: s.folder, papers: s.papers, trashed: s.trashed, place: s.place, query: s.query, pdfDirs: s.pdfDirs }), paint);
  return () => { offScope(); header.dispose(); };
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
  const one = ids.length === 1 ? listPapersUnder(listPlacePapers(s), PAPERS_DIR, s.pdfDirs).find((p) => p.id === ids[0]) ?? null : null;
  if (s.place === "trash") return trashMenuEntries(ctx, ids);
  return [
    ...(one ? openEntries(ctx, one) : []),
    ...copyEntries(ctx, ids),
    ...statusEntries(ctx, ids),
    ...organizeEntries(ctx, ids, one),
    {
      icon: "trash", label: ids.length > 1 ? `Move ${ids.length} Papers to Trash` : "Move to Trash", hint: KEY_HINT.remove,
      onSelect: () => trashPapers(ctx, ids),
    },
  ];
}

/** The menu of papers in the Trash: Restore, copy, and Delete Forever. */
function trashMenuEntries(ctx: UiContext, ids: string[]): MenuEntry[] {
  return [
    { icon: "refresh", label: ids.length > 1 ? `Restore ${ids.length} Papers` : "Restore", onSelect: () => restorePapers(ctx, ids) },
    "separator",
    ...copyEntries(ctx, ids),
    {
      icon: "trash", danger: true, label: ids.length > 1 ? `Delete ${ids.length} Papers Forever…` : "Delete Forever…", hint: KEY_HINT.remove,
      onSelect: () => { void askRemove(ctx, ids); },
    },
  ];
}

export function showPaperMenu(ctx: UiContext, at: MenuAnchor | HTMLElement, onClose?: () => void): void {
  const ids = [...ctx.store.get().selected];
  if (ids.length > 0) showMenu(at, paperMenuEntries(ctx, ids), onClose ? { onClose } : {});
}
