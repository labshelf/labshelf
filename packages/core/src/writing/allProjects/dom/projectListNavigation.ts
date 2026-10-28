// Drives the project treegrid's rows: the flat row model, the windowed rendering, focus keeping, keyboard shortcuts and aria-row lookup.
import { RowReconciler, createRowWindow, readRowHeight, type RowSlice, type RowViewport, type RowWindow } from "../../../libraryUi/dom/list/index.js";
import { deriveListShortcutAction } from "../../../libraryUi/index.js";
import type { ProjectGroup, ProjectRow } from "../projectModel.js";
import type { ProjectTrayRow } from "./projectTray.js";

/** The element carrying `role=row`: the node itself, or a project's main row inside its wrapper. */
export const findAriaRow = (node: HTMLElement): HTMLElement =>
  node.matches('[role="row"]') ? node : node.querySelector<HTMLElement>('[role="row"]')!;

/** `key` is unique in the list; `level` is the treegrid's aria-level. */
export type ProjectListRow =
  | { kind: "group"; key: string; level: number; group: ProjectGroup; collapsed: boolean }
  | { kind: "project"; key: string; level: number; row: ProjectRow }
  | { kind: "file"; key: string; level: number; projectId: string; tray: ProjectTrayRow };

interface ProjectListInput {
  groups: readonly ProjectGroup[];
  /** Group keys whose projects are hidden. */
  collapsed: ReadonlySet<string>;
  expanded: string | null;
  trayRows: (row: ProjectRow) => ProjectTrayRow[];
}

export const createProjectKey = (id: string): string => `p:${id}`;

// A group without segments holds the top-level projects, so it has no header and its projects sit at level 1.
export function deriveProjectListRows(input: ProjectListInput): ProjectListRow[] {
  const out: ProjectListRow[] = [];
  for (const group of input.groups) {
    const grouped = group.segments.length > 0;
    if (grouped) {
      const collapsed = input.collapsed.has(group.key);
      out.push({ kind: "group", key: `g:${group.key}`, level: 1, group, collapsed });
      if (collapsed) continue;
    }
    const level = grouped ? 2 : 1;
    for (const row of group.rows) {
      out.push({ kind: "project", key: createProjectKey(row.id), level, row });
      if (row.id !== input.expanded) continue;
      for (const tray of input.trayRows(row)) {
        out.push({ kind: "file", key: `f:${row.id}\n${tray.name}`, level: level + 1 + tray.depth, projectId: row.id, tray });
      }
    }
  }
  return out;
}

interface FocusKeeper {
  /** Runs `paint`, then puts focus back on the row with the focused key; `nodeOf` finds a rendered row by key. */
  around(paint: () => void, nodeOf: (key: string) => HTMLElement | undefined): void;
}

export function createRowFocusKeeper(list: HTMLElement): FocusKeeper {
  let focused: string | null = null;
  list.addEventListener("focusin", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset["key"];
    if (key) focused = key;
  });
  return {
    around(paint, nodeOf) {
      const active = document.activeElement;
      const inside = active !== null && list.contains(active);
      paint();
      if (!inside || focused === null) return;
      const node = nodeOf(focused);
      // A row scrolled out of the window parks focus on the list, which does not forward it, so a wheel scroll never jumps back.
      if (!node) { if (document.activeElement !== list) list.focus({ preventScroll: true }); return; }
      const row = findAriaRow(node);
      if (!row.contains(document.activeElement)) row.focus({ preventScroll: true });
    },
  };
}

interface WindowParts<T> {
  build: (item: T) => HTMLElement;
  /** The values a row renders from; a row is rebuilt when any of them changes identity. */
  inputs: (item: T) => readonly unknown[];
  /** Paints a rendered row's state; `index` is its place in the whole list. */
  decorate: (item: T, node: HTMLElement, index: number) => void;
  focus: FocusKeeper;
}

interface WindowedRows<T> {
  update(items: readonly T[], empty: HTMLElement | null): void;
  /** Scrolls the row at `index` into view and returns its node, or null past the end. */
  reveal(index: number): HTMLElement | null;
  /** How many rows fit the viewport, or null when the list has no layout. */
  viewportRows(): number | null;
}

function keyedRows<T extends { id: string }>(body: HTMLElement, parts: WindowParts<T>): RowReconciler<T> {
  return new RowReconciler<T>(body, (item) => {
    const node = parts.build(item);
    node.dataset["key"] = item.id;
    return node;
  }, parts.inputs);
}

/** Repaints at most once per animation frame while the list scrolls. */
function repaintOnScroll(list: HTMLElement, paint: () => void): void {
  let pending = 0;
  list.addEventListener("scroll", () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; paint(); });
  }, { passive: true });
}

/** `heads` is the sticky column-heads row, which covers the top of the scroll viewport. */
export function createWindowedRows<T extends { id: string }>(list: HTMLElement, body: HTMLElement, heads: HTMLElement, parts: WindowParts<T>): WindowedRows<T> {
  const rows = keyedRows(body, parts);
  let items: readonly T[] = [];
  let empty: HTMLElement | null = null;
  let nodes = new Map<string, HTMLElement>();
  let win: RowWindow | null = null;
  // A list without layout (hidden, or jsdom) has no viewport, so every row renders.
  const viewport = (): RowViewport | null => {
    const height = list.clientHeight - heads.offsetHeight;
    if (!(height > 0)) return null;
    win ??= createRowWindow({ rowHeight: readRowHeight(list) });
    return { scrollTop: list.scrollTop, height };
  };
  const sliceOf = (v: RowViewport | null): RowSlice =>
    v && win ? win.slice(items.length, v) : { start: 0, end: items.length, padTop: 0, padBottom: 0 };
  const paint = (): void => parts.focus.around(() => {
    const s = sliceOf(viewport());
    body.style.paddingTop = `${s.padTop}px`;
    body.style.paddingBottom = `${s.padBottom}px`;
    const shown = items.slice(s.start, s.end);
    rows.update(shown, empty);
    nodes = new Map(shown.map((item, i) => [item.id, body.children[i] as HTMLElement]));
    shown.forEach((item, i) => parts.decorate(item, nodes.get(item.id)!, s.start + i));
  }, (key) => nodes.get(key));
  repaintOnScroll(list, paint);
  // ResizeObserver is absent where the list renders without layout (jsdom); a resize can change the row height token too.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { win = null; paint(); }).observe(list);
  return {
    update(next, nextEmpty) {
      items = next;
      empty = nextEmpty;
      paint();
    },
    viewportRows() {
      const v = viewport();
      return v && win ? win.indexAt(v.height) : null;
    },
    reveal(index) {
      const item = items[index];
      if (!item) return null;
      const v = viewport();
      if (v && win) list.scrollTop = win.scrollTopFor(index, v);
      paint();
      return nodes.get(item.id) ?? null;
    },
  };
}

interface ProjectShortcutHandlers {
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (id: string, anchor: HTMLElement) => void;
}

interface ProjectShortcutRows {
  rows: () => readonly ProjectListRow[];
  reveal: (index: number) => HTMLElement | null;
  toggleGroup: (key: string) => void;
  /** Rows a PageUp or PageDown moves over: the viewport's rows minus one, at least one. */
  pageSize: () => number;
  /** The selected project id at the time of the key press. */
  selected: () => string | null;
}

const projectOf = (r: ProjectListRow): string | null => (r.kind === "project" ? r.row.id : r.kind === "file" ? r.projectId : null);

function focusAt(ctx: ProjectShortcutRows, h: ProjectShortcutHandlers, index: number): void {
  const row = ctx.rows()[index];
  const node = row ? ctx.reveal(index) : null;
  if (!row || !node) return;
  findAriaRow(node).focus();
  // A file row keeps its project selected, so the selection never points at a hidden row.
  const id = projectOf(row);
  if (id && id !== ctx.selected()) h.onSelect(id);
}

// A folder's row toggles through its click handler; a project through the list's handler.
function toggle(ctx: ProjectShortcutRows, h: ProjectShortcutHandlers, row: ProjectListRow, node: HTMLElement): void {
  if (row.kind === "group") ctx.toggleGroup(row.group.key);
  else if (row.kind === "project") h.onToggle(row.row.id);
  else node.click();
}

function parentOf(rows: readonly ProjectListRow[], at: number): number {
  for (let i = at - 1; i >= 0; i--) if (rows[i]!.level < rows[at]!.level) return i;
  return -1;
}

function currentIndex(el: HTMLElement, ctx: ProjectShortcutRows): number {
  const active = document.activeElement;
  const key = active && el.contains(active) ? active.closest<HTMLElement>("[data-key]")?.dataset["key"] : undefined;
  const selected = ctx.selected();
  return ctx.rows().findIndex((r) => (key ? r.key === key : r.kind === "project" && r.row.id === selected));
}

// Home, End, PageUp and PageDown use the paper list's key map, so both lists page the same way.
function jumpTarget(e: KeyboardEvent, at: number, ctx: ProjectShortcutRows): number | null {
  const action = deriveListShortcutAction({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
  const last = ctx.rows().length - 1;
  if (action?.kind === "edge") return action.to === "first" ? 0 : last;
  if (action?.kind === "page") return Math.max(0, Math.min(last, Math.max(0, at) + action.dir * ctx.pageSize()));
  return null;
}

function onKey(e: KeyboardEvent, el: HTMLElement, h: ProjectShortcutHandlers, ctx: ProjectShortcutRows): boolean {
  const rows = ctx.rows();
  const at = currentIndex(el, ctx);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { focusAt(ctx, h, Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))); return true; }
  const jump = jumpTarget(e, at, ctx);
  if (jump !== null) { focusAt(ctx, h, jump); return true; }
  const row = rows[at];
  const node = row ? ctx.reveal(at) : null;
  if (!row || !node) return false;
  const open = findAriaRow(node).getAttribute("aria-expanded");
  if (e.key === "ArrowRight") { if (open === "false") toggle(ctx, h, row, node); else if (open === "true") focusAt(ctx, h, at + 1); }
  else if (e.key === "ArrowLeft") { if (open === "true") toggle(ctx, h, row, node); else focusAt(ctx, h, parentOf(rows, at)); }
  else if (e.key === "Enter") { if (row.kind === "project") h.onOpen(row.row.id); else toggle(ctx, h, row, node); }
  else if ((e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) && row.kind === "project") {
    const button = node.querySelector<HTMLElement>('[data-act="menu"]');
    if (button) h.onMenu(row.row.id, button);
  } else return false;
  return true;
}

export function attachProjectShortcuts(el: HTMLElement, h: ProjectShortcutHandlers, ctx: ProjectShortcutRows): void {
  el.addEventListener("keydown", (e) => { if (onKey(e, el, h, ctx)) e.preventDefault(); });
}
