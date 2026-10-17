// Moves through the project treegrid from the keyboard: project and file rows, expanding, opening and the row menu.
import { collapseOrLeave, expandOrEnter, focusRow, focusedChildRow, focusedRow, paperIdOf, paperRowOf, visibleRows } from "../../../library-ui/dom/index.js";

export interface ProjectKeyHandlers {
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (id: string, anchor: HTMLElement) => void;
}

function walk(el: HTMLElement, h: ProjectKeyHandlers, selected: string | null, step: 1 | -1): void {
  const rows = visibleRows(el);
  const current = focusedRow(el) ?? paperRowOf(el, selected);
  const at = current ? rows.indexOf(current) : -1;
  const next = rows[Math.max(0, Math.min(rows.length - 1, at + step))];
  if (!next) return;
  // A file row keeps its project selected, so the selection never points at a hidden row.
  const id = paperIdOf(next);
  if (id !== selected) h.onSelect(id);
  focusRow(next);
}

/** `selected` reads the selected project id at the time of the key press. */
export function wireProjectKeys(el: HTMLElement, h: ProjectKeyHandlers, selected: () => string | null): void {
  el.addEventListener("keydown", (e) => {
    const current = selected();
    const child = focusedChildRow(el);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") walk(el, h, current, e.key === "ArrowDown" ? 1 : -1);
    else if (e.key === "ArrowRight") expandOrEnter(el, current);
    else if (e.key === "ArrowLeft") collapseOrLeave(el, current);
    else if (e.key === "Enter" && child) child.click();
    else if (e.key === "Enter" && current) h.onOpen(current);
    else if ((e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) && current) {
      const button = el.querySelector<HTMLElement>(`.paper-row.selected [data-act="menu"]`);
      if (button) h.onMenu(current, button);
    } else return;
    e.preventDefault();
  });
}
