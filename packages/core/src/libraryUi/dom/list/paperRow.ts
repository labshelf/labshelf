/**
 * Builds one paper as treegrid rows: the paper row (twistie, title with its state icon, then the columns the reader
 * shows: authors, venue, year, Last read and a status mark that cycles) and the tray that holds its files; a right-click opens the paper menu.
 */
import { formatAuthors } from "../../../library/index.js";
import { deriveVenue } from "../../../model/index.js";
import { renderElement, renderHighlightedHtml } from "../../../ui/dom/index.js";
import { escapeHtml, renderIcon } from "../../../ui/index.js";
import type { ListPaper } from "../../viewModel/index.js";
import { COLUMN_KEYS, type ListColumn } from "../../store/index.js";
import type { PaperStats, TextLayerJobView } from "../../protocol/index.js";
import { renderLastReadHtml, renderTextLayerIconHtml, renderReadingStatusMarkHtml } from "./rowCells.js";

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
