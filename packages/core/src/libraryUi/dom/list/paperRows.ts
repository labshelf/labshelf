/**
 * Builds the rows of the paper list: one paper as treegrid rows with its tray, the sortable column heads, the split of the
 * sorted papers into folder groups, the labelled rowgroups that render them, and the list keymap run on key presses.
 */
import { formatAuthors, deriveParentDir } from "../../../library/index.js";
import { deriveVenue } from "../../../model/index.js";
import { renderElement, renderHighlightedHtml } from "../../../ui/dom/index.js";
import { escapeHtml, renderIcon } from "../../../ui/index.js";
import type { ListPaper } from "../../listModel.js";
import { COLUMN_KEYS, type ListColumn } from "../../store/index.js";
import type { PaperStats, TextLayerJobView } from "../../protocol/index.js";
import { renderLastReadHtml, renderTextLayerIconHtml, renderReadingStatusMarkHtml, RowReconciler } from "./paperList.js";
import { deriveListShortcutAction, type ListShortcutAction } from "../../listModel.js";
import { askRemove, copyCitation, openPaper, setReadingStatus } from "../flows/index.js";
import { showPaperMenu } from "../libraryChrome.js";
import { isOverlayOpen, type ListCursor, type UiContext } from "../uiContext.js";
import { closeOrLeave, openOrEnter, findFocusedChildRow, findPaperRow } from "./tree.js";

export interface RowHandlers {
  onClick: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onCycleStatus: (p: ListPaper) => void;
  onTag: (tag: string) => void;
  onMenu: (id: string, e: MouseEvent) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
}

/** What a row shows besides its record. */
export interface RowView {
  terms: string[];
  stats: PaperStats | undefined;
  job: TextLayerJobView | undefined;
  textLayer: boolean;
  columns: readonly ListColumn[];
}

function tagsHtml(tags: readonly string[] | undefined): string {
  if (!tags?.length) return "";
  const buttons = tags.map((t) => `<button type="button" class="row-tag" data-tag="${escapeHtml(t)}" tabindex="-1" title="Show papers tagged ${escapeHtml(t)}">` +
    `<span class="row-tag-hash">#</span>${escapeHtml(t)}</button>`);
  return `<span class="row-tags">${buttons.join("")}</span>`;
}

function titleCell(p: ListPaper, v: RowView): string {
  return `<div class="col-title title-cell" title="${escapeHtml(p.title)}"><span class="title-text">${renderHighlightedHtml(p.title, v.terms)}</span>` +
    renderTextLayerIconHtml(p, v.job, v.textLayer) + tagsHtml(p.tags) + `</div>`;
}

function optionalCells(p: ListPaper, v: RowView): string {
  const cells: Record<ListColumn, () => string> = {
    creator: () => `<div class="col-meta col-creator" title="${escapeHtml((p.authors ?? []).join(", "))}">${renderHighlightedHtml(formatAuthors(p.authors), v.terms)}</div>`,
    venue: () => `<div class="col-meta col-venue" title="${escapeHtml(deriveVenue(p))}">${renderHighlightedHtml(deriveVenue(p), v.terms)}</div>`,
    year: () => `<div class="col-meta col-year">${p.year ? renderHighlightedHtml(p.year, v.terms) : ""}</div>`,
    lastRead: () => renderLastReadHtml(v.stats),
    status: () => `<div class="col-meta col-status">${renderReadingStatusMarkHtml(p.status)}</div>`,
  };
  return COLUMN_KEYS.filter((k) => v.columns.includes(k)).map((k) => cells[k]()).join("");
}

function rowHtml(p: ListPaper, v: RowView, expanded: boolean): string {
  const twistie = `<div class="expand-btn${expanded ? "" : " collapsed"}" title="Attachments">${renderIcon("chevron-down")}</div>`;
  return `<div class="paper-row-main" role="row" aria-level="1" aria-selected="false" tabindex="-1" aria-expanded="${expanded}">` + twistie + titleCell(p, v) +
      optionalCells(p, v) +
    `</div>` +
    `<div class="paper-children" role="none"></div>`;
}

function wireMain(row: HTMLElement, p: ListPaper, h: RowHandlers): void {
  const main = row.querySelector<HTMLElement>(".paper-row-main")!;
  main.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const tag = target.closest<HTMLElement>(".row-tag")?.dataset["tag"];
    if (tag !== undefined) { e.stopPropagation(); h.onTag(tag); return; }
    if (target.closest("[data-cycle]")) { e.stopPropagation(); h.onCycleStatus(p); return; }
    h.onClick(p.id, e);
  });
  main.addEventListener("dblclick", (e) => {
    if (!(e.target as HTMLElement).closest("[data-cycle], .row-tag")) h.onOpen(p.id);
  });
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); h.onMenu(p.id, e); });
}

/** Builds one paper row; every paper expands, since its tray holds at least the Note row. */
export function buildPaperRow(p: ListPaper, v: RowView, h: RowHandlers): HTMLElement {
  const expanded = h.isOpen(p.id);
  const row = renderElement("div", { class: `paper-row${expanded ? " expanded" : ""}${p.relFolder === "" ? "" : " in-group"}`, role: "none", "data-id": p.id, html: rowHtml(p, v, expanded) });
  row.draggable = true;
  row.querySelectorAll('[role="row"] > div').forEach((cell) => cell.setAttribute("role", "gridcell"));
  const expandBtn = row.querySelector<HTMLElement>(".expand-btn");
  expandBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    h.onToggle(p.id);
  });
  wireMain(row, p, h);
  row.addEventListener("dragstart", (e) => h.onDragStart(p.id, e));
  row.addEventListener("dragend", h.onDragEnd);
  return row;
}

export interface SortableHeader {
  key: string;
  label: string;
  cls: string;
  title?: string;
  /** False renders a plain head with the same look and no sort affordance. */
  sortable: boolean;
}

export function renderSortableHeadHtml({ key, label, cls, title, sortable }: SortableHeader): string {
  const tip = title ? ` title="${escapeHtml(title)}"` : "";
  if (!sortable) return `<div class="col-head ${cls}" role="columnheader"${tip}>${escapeHtml(label)}</div>`;
  return `<div class="col-head sortable ${cls}" role="columnheader" aria-sort="none" data-sort="${escapeHtml(key)}"${tip}>` +
    `${escapeHtml(label)}<span class="sort-ind" aria-hidden="true">${renderIcon("chevron-down")}</span></div>`;
}

/** Calls `onSort` with the key of a clicked sortable head; returns the function that stops listening. */
export function attachSortableHeads(heads: HTMLElement, onSort: (key: string) => void): () => void {
  const onClick = (e: MouseEvent): void => {
    const key = (e.target as HTMLElement).closest<HTMLElement>(".sortable")?.dataset["sort"];
    if (key) onSort(key);
  };
  heads.addEventListener("click", onClick);
  return () => heads.removeEventListener("click", onClick);
}

export function drawSortableHeads(heads: HTMLElement, key: string, ascending: boolean): void {
  heads.querySelectorAll<HTMLElement>(".sortable").forEach((h) => {
    h.setAttribute("aria-sort", h.dataset["sort"] !== key ? "none" : ascending ? "ascending" : "descending");
  });
}

const SEP = "/";
const LABEL_SEP = " › ";
const MAX_SEGMENTS = 3;

/** Papers that share one holder folder. */
export interface PaperGroup {
  /** The holder folder's path; distinct per group. */
  key: string;
  /** Holder folder path below the scope; empty for the papers directly in the scope. */
  segments: string[];
  papers: ListPaper[];
  /** The group's paper count, also when `papers` is cut to the rendered window. */
  total: number;
}

function segmentsBelow(scope: string, folderPath: string): string[] {
  return folderPath === scope ? [] : folderPath.slice(scope.length + 1).split(SEP);
}

/** The own group first (when it has papers), then the subfolder groups by path; `papers` keep their order inside each. */
export function derivePaperGroups(papers: readonly ListPaper[], scope: string): PaperGroup[] {
  const byFolder = new Map<string, PaperGroup>();
  for (const p of papers) {
    const group = byFolder.get(p.folderPath) ?? { key: p.folderPath, segments: segmentsBelow(scope, p.folderPath), papers: [], total: 0 };
    group.papers.push(p);
    group.total++;
    byFolder.set(p.folderPath, group);
  }
  const path = (g: PaperGroup): string => g.segments.join(SEP);
  return [...byFolder.values()].sort((a, b) => path(a).localeCompare(path(b)));
}

/** The indices of the segments the label shows (first, second-last and last past three) and the full path for its tooltip. */
export function deriveGroupLabel(segments: readonly string[]): { shown: number[]; title: string } {
  const n = segments.length;
  return { shown: n <= MAX_SEGMENTS ? segments.map((_, i) => i) : [0, n - 2, n - 1], title: segments.join(LABEL_SEP) };
}

/** The accessible name of a group: its full path and paper count. */
export function deriveGroupAriaLabel(segments: readonly string[], count: number): string {
  return `${segments.join(LABEL_SEP)}, ${count} ${count === 1 ? "paper" : "papers"}`;
}

const SEP_HTML = `<span class="group-sep">${renderIcon("chevron-right")}</span>`;

/** The path of the folder `up` levels above `folder`. */
const ancestor = (folder: string, up: number): string => folder.split("/").slice(0, folder.split("/").length - up).join("/");

/**
 * The label element for the group of `folder`, at `segments` below the scope. Each segment is a button carrying its
 * folder in data-folder; the label is hidden from assistive tech because the rowgroup carries the name, and the
 * sidebar and breadcrumb are the keyboard path to a folder.
 */
function buildGroupLabel(folder: string, segments: readonly string[]): HTMLElement {
  const { shown, title } = deriveGroupLabel(segments);
  const last = segments.length - 1;
  const crumbs = shown.map((i, k) => {
    const gap = k > 0 && i > shown[k - 1]! + 1 ? `<span class="group-gap">…</span>${SEP_HTML}` : "";
    const btn = `<button type="button" tabindex="-1" class="${i === last ? "group-last" : "group-parent"}" ` +
      `data-folder="${escapeHtml(ancestor(folder, last - i))}" title="Open ${escapeHtml(segments[i]!)}">${escapeHtml(segments[i]!)}</button>`;
    return gap + btn;
  });
  return renderElement("div", {
    class: "group-label", "aria-hidden": "true", title,
    html: crumbs.join(SEP_HTML),
  });
}

/** A group with an empty `segments` renders without a label. */
export interface RowGroup {
  key: string;
  segments: string[];
}

export interface GroupedRowsSource<T, G> {
  items: (group: G) => readonly T[];
  /** The rowgroup's accessible name, such as its path and item count. */
  ariaLabel: (group: G) => string;
}

interface GroupShell<T extends { id: string }> {
  node: HTMLElement;
  body: HTMLElement;
  rows: RowReconciler<T>;
  label: HTMLElement | null;
  /** The accessible name the current label was built for. */
  labelSig: string;
}

interface GroupItem<G> {
  id: string;
  group: G;
}

export class GroupedRows<T extends { id: string }, G extends RowGroup> {
  private shells = new Map<string, GroupShell<T>>();
  private readonly groups: RowReconciler<GroupItem<G>>;

  constructor(container: HTMLElement, private readonly makeRows: (body: HTMLElement) => RowReconciler<T>, private readonly access: GroupedRowsSource<T, G>) {
    // The shell is rebuilt only when a group switches between the unlabelled top group and a labelled subfolder.
    this.groups = new RowReconciler<GroupItem<G>>(container, (item) => this.buildShell(item), (item) => [item.group.segments.length === 0]);
  }

  /** Renders `groups` in order, followed by `trailing` (an empty state) when given. */
  update(groups: readonly G[], trailing: HTMLElement | null): void {
    this.groups.update(groups.map((group) => ({ id: group.key, group })), trailing);
    const alive = new Set(groups.map((g) => g.key));
    for (const key of [...this.shells.keys()]) if (!alive.has(key)) this.shells.delete(key);
    for (const g of groups) this.paintShell(this.shells.get(g.key)!, g);
  }

  private buildShell({ group }: GroupItem<G>): HTMLElement {
    const body = renderElement("div", { class: "group-body", role: "none" });
    const node = renderElement("div", { class: "paper-group", role: "rowgroup" }, body);
    this.shells.set(group.key, { node, body, rows: this.makeRows(body), label: null, labelSig: "" });
    return node;
  }

  private paintShell(shell: GroupShell<T>, group: G): void {
    shell.rows.update(this.access.items(group));
    if (group.segments.length === 0) return;
    const aria = this.access.ariaLabel(group);
    if (shell.labelSig === aria) return;
    shell.node.setAttribute("aria-label", aria);
    const label = buildGroupLabel(group.key, group.segments);
    if (shell.label) shell.label.replaceWith(label);
    else shell.node.insertBefore(label, shell.body);
    shell.label = label;
    shell.labelSig = aria;
  }
}

// The menu key opens the menu of the focused file row, or the paper menu under the cursor row, a little in from its left edge.
function openMenuAtCursor(ctx: UiContext): void {
  const child = findFocusedChildRow(ctx.root);
  if (child) {
    const c = child.getBoundingClientRect();
    child.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: c.left + 40, clientY: c.bottom }));
    return;
  }
  const { cursor, selected } = ctx.store.get();
  const row = findPaperRow(ctx.root, cursor);
  if (!row || selected.size === 0) return;
  const r = row.getBoundingClientRect();
  showPaperMenu(ctx, { x: r.left + 40, y: r.bottom });
}

function ignored(e: KeyboardEvent, ctx: UiContext): boolean {
  const active = document.activeElement as HTMLElement | null;
  // An overlay that took the key (Escape closing a menu) has already handled it.
  if (isOverlayOpen() || e.defaultPrevented || ctx.store.get().citationMap) return true;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return true;
  if (active && ctx.root.querySelector(".sidebar")?.contains(active)) return true;
  return !!active && active.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ");
}

/** Performs a list action; returns false when the key should keep its default behaviour. */
function perform(ctx: UiContext, cursor: ListCursor, action: ListShortcutAction): boolean {
  const s = ctx.store.get();
  switch (action.kind) {
    case "focusSearch": ctx.focusSearch(true); return true;
    case "step": cursor.step(action.delta, action.extend); return true;
    case "page": cursor.page(action.dir, action.extend); return true;
    case "edge": cursor.edge(action.to); return true;
    case "parent": if (s.folder.includes("/")) ctx.store.openFolder(deriveParentDir(s.folder, "/")); return true;
    case "open": {
      // A child row acts as its own click does, so each kind of child row decides what opening it means.
      const child = findFocusedChildRow(ctx.root);
      if (child) child.click(); else if (s.cursor) openPaper(ctx, s.cursor);
      return true;
    }
    case "expand": return openOrEnter(ctx.root, s.cursor);
    case "collapse": return closeOrLeave(ctx.root, s.cursor);
    case "escape":
      if (s.query) ctx.store.set({ query: "" });
      else ctx.store.clearSelection();
      return true;
    case "selectAll": ctx.store.set({ selected: new Set(cursor.order()) }); return true;
    case "setStatus": setReadingStatus(ctx, [...s.selected], action.status); return true;
    case "remove": if (s.selected.size) void askRemove(ctx, [...s.selected]); return true;
    case "copyKeys":
      // A text selection copies as text; the keys are copied only when nothing is selected on the page.
      if (s.selected.size === 0 || window.getSelection()?.toString()) return false;
      copyCitation(ctx, [...s.selected], "key");
      return true;
    case "menu": openMenuAtCursor(ctx); return true;
    case "typeToSearch":
      // Focus moves before the key lands, so the character types into the search box.
      ctx.focusSearch();
      return false;
  }
}

/** Starts listening for list keys; returns the function that stops it. */
export function attachListShortcuts(ctx: UiContext, cursor: ListCursor): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (ignored(e, ctx)) return;
    const action = deriveListShortcutAction({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
    if (action && perform(ctx, cursor, action)) e.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
