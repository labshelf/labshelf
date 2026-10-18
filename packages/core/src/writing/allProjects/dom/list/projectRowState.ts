// Marks a rendered treegrid row with its position, level, expansion and selection, in place so focus survives.
import type { ProjectRow } from "../../projectRow.js";
import type { ProjectListRow } from "./projectListModel.js";

export interface RowStateFrame {
  selected: string | null;
  expanded: string | null;
}

/** The element carrying `role=row`: the node itself, or a project's main row inside its wrapper. */
export const ariaRowOf = (node: HTMLElement): HTMLElement =>
  node.matches('[role="row"]') ? node : node.querySelector<HTMLElement>('[role="row"]')!;

function paintProject(p: ProjectRow, node: HTMLElement, row: HTMLElement, f: RowStateFrame): void {
  const selected = p.id === f.selected;
  node.classList.toggle("selected", selected);
  row.setAttribute("aria-selected", String(selected));
  row.tabIndex = selected ? 0 : -1;
  if (p.broken) return;
  const open = p.id === f.expanded;
  node.classList.toggle("expanded", open);
  node.querySelector(".expand-btn")?.classList.toggle("collapsed", !open);
  row.setAttribute("aria-expanded", String(open));
}

/** `index` is the row's place in the whole model; the column heads take aria-rowindex 1. */
export function paintRowState(item: ProjectListRow, node: HTMLElement, index: number, f: RowStateFrame): void {
  const row = ariaRowOf(node);
  row.setAttribute("aria-rowindex", String(index + 2));
  row.setAttribute("aria-level", String(item.level));
  if (item.kind === "group") row.setAttribute("aria-expanded", String(!item.collapsed));
  // Folders inside the tray indent through --depth; --indent steps the whole tray in under a grouped project.
  else if (item.kind === "file") node.style.setProperty("--indent", String(item.level - 2 - item.tray.depth));
  else paintProject(item.row, node, row, f);
}
