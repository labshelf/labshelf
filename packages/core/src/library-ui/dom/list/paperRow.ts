/**
 * Builds one paper as treegrid rows: the paper row (twistie, title with its state icon, authors, year, Last read and
 * a status mark that cycles) and the tray that holds its files; a right-click opens the paper menu.
 */
import { formatAuthors } from "../../../library/index.js";
import { el, highlight } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { ListPaper } from "../../derive/index.js";
import type { PaperStats, TextLayerJobView } from "../../protocol/index.js";
import { lastReadHtml, stateIconHtml, statusMarkHtml } from "./rowCells.js";

export interface RowHandlers {
  onClick: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onCycleStatus: (p: ListPaper) => void;
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
}

function titleCell(p: ListPaper, v: RowView): string {
  return `<div class="col-title title-cell" title="${escapeHtml(p.title)}"><span class="title-text">${highlight(p.title, v.terms)}</span>` +
    stateIconHtml(p, v.job, v.textLayer) + `</div>`;
}

function rowHtml(p: ListPaper, v: RowView, expanded: boolean): string {
  const twistie = `<div class="expand-btn${expanded ? "" : " collapsed"}" title="Attachments">${icon("chevron-down")}</div>`;
  return `<div class="paper-row-main" role="row" aria-level="1" aria-selected="false" tabindex="-1" aria-expanded="${expanded}">` + twistie + titleCell(p, v) +
      `<div class="col-meta col-creator" title="${escapeHtml((p.authors ?? []).join(", "))}">${highlight(formatAuthors(p.authors), v.terms)}</div>` +
      `<div class="col-meta col-year">${p.year ? highlight(p.year, v.terms) : ""}</div>` +
      lastReadHtml(v.stats) +
      `<div class="col-meta">${statusMarkHtml(p.status)}</div>` +
    `</div>` +
    `<div class="paper-children" role="none"></div>`;
}

function wireMain(row: HTMLElement, p: ListPaper, h: RowHandlers): void {
  const main = row.querySelector<HTMLElement>(".paper-row-main")!;
  main.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cycle]")) { e.stopPropagation(); h.onCycleStatus(p); return; }
    h.onClick(p.id, e);
  });
  main.addEventListener("dblclick", (e) => {
    if (!(e.target as HTMLElement).closest("[data-cycle]")) h.onOpen(p.id);
  });
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); h.onMenu(p.id, e); });
}

/** Builds one paper row; every paper expands, since its tray holds at least the Note row. */
export function buildPaperRow(p: ListPaper, v: RowView, h: RowHandlers): HTMLElement {
  const expanded = h.isOpen(p.id);
  const row = el("div", { class: `paper-row${expanded ? " expanded" : ""}${p.relFolder === "" ? "" : " in-group"}`, role: "none", "data-id": p.id, html: rowHtml(p, v, expanded) });
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
