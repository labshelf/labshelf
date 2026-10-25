// Moves through the project treegrid's flat rows from the keyboard: arrows, Home/End, paging, expanding and collapsing, opening and the row menu.
import { deriveListShortcutAction } from "../../../../libraryUi/index.js";
import type { ProjectListRow } from "./projectListModel.js";
import { findAriaRow } from "./projectRowState.js";

export interface ProjectShortcutHandlers {
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (id: string, anchor: HTMLElement) => void;
}

export interface ProjectShortcutRows {
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
