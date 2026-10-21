// Moves focus through the sidebar and acts on the focused row from the keyboard, as VS Code's tree does.
import type { GroupId, SectionId } from "./sidebarSections.js";
import { rowKey } from "./sidebarRows.js";
import { NAV_ROWS, paintFocus, setExpanded, toggleSection, type SidebarState } from "./sidebarView.js";

const depthOf = (r: HTMLElement): number => Number(r.style.getPropertyValue("--depth") || 0);

/** The nearest row above `idx` that is one level up: the folder holding the row. */
function parentIndex(rows: HTMLElement[], idx: number): number {
  const depth = depthOf(rows[idx]!);
  for (let i = idx - 1; i >= 0; i--) if (rows[i]!.dataset["path"] && depthOf(rows[i]!) < depth) return i;
  return -1;
}

/** Raises the row's right-click event at the row's bottom-left, so the keyboard opens exactly the menu the pointer does. */
function openRowMenu(row: HTMLElement): void {
  const { left, bottom } = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: left, clientY: bottom }));
}

export function onSidebarKey(e: KeyboardEvent, t: SidebarState, activate: (row: HTMLElement) => void): void {
  const rows = Array.from(t.el.querySelectorAll<HTMLElement>(NAV_ROWS));
  if (rows.length === 0) return;
  let idx = t.focused ? rows.findIndex((r) => rowKey(r) === t.focused) : -1;
  if (idx === -1) idx = Math.max(0, rows.findIndex((r) => r.classList.contains("current") || r.getAttribute("aria-selected") === "true"));
  const current = rows[idx]!;
  const path = current.dataset["path"];
  const open = current.getAttribute("aria-expanded") === "true";
  const section = (current.dataset["section"] ?? current.dataset["group"]) as SectionId | GroupId | undefined;
  const focus = (i: number): void => { t.focused = rowKey(rows[Math.min(rows.length - 1, Math.max(0, i))]!); };
  if (e.key === "ArrowDown") focus(idx + 1);
  else if (e.key === "ArrowUp") focus(idx - 1);
  else if (e.key === "Home") focus(0);
  else if (e.key === "End") focus(rows.length - 1);
  else if (section && (e.key === "ArrowRight" ? !open : e.key === "ArrowLeft" && open)) toggleSection(t, section);
  else if (e.key === "ArrowRight") { if (path && current.getAttribute("aria-expanded") === "false") setExpanded(t, path, true); else if (open) focus(idx + 1); }
  else if (e.key === "ArrowLeft") { if (path && open) setExpanded(t, path, false); else { const p = parentIndex(rows, idx); if (p >= 0) focus(p); } }
  else if (e.key === "Enter" || e.key === " ") activate(current);
  else if (e.key === "F2" && path) t.actions.renameFolder(path);
  else if ((e.key === "Delete" || e.key === "Backspace") && path) t.actions.removeFolder(path);
  else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) openRowMenu(current);
  else return;
  e.preventDefault();
  paintFocus(t);
}
