/**
 * Builds one paper row: twistie and PDF child row, type icon, title with version and tags, location chip and marks, creator,
 * year, publication, Last read and a status badge that cycles; a right-click opens the paper menu.
 */
import { PDF_FILE, formatAuthors } from "../../../library/index.js";
import { STATUS_LABEL, nextStatus } from "../../../model/index.js";
import { el, highlight } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { ListPaper } from "../../derive/index.js";
import type { PaperStats, TextLayerJobView } from "../../protocol/index.js";
import { lastReadHtml, marksHtml, tagChipsHtml, typeIconHtml, versionChipHtml } from "./rowCells.js";

export interface RowHandlers {
  onClick: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onCycleStatus: (p: ListPaper) => void;
  onOpenFolder: (folder: string) => void;
  onSearchTag: (tag: string) => void;
  onMenu: (id: string, e: MouseEvent) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  isExpanded: (id: string) => boolean;
  setExpanded: (id: string, open: boolean) => void;
}

/** What a row shows besides its record. */
export interface RowView {
  terms: string[];
  stats: PaperStats | undefined;
  job: TextLayerJobView | undefined;
  textLayer: boolean;
}

function titleCell(p: ListPaper, v: RowView): string {
  const chip = p.relFolder ? `<span class="loc-chip" title="Go to ${escapeHtml(p.relFolder)}">${highlight(p.relFolder, v.terms)}</span>` : "";
  return `<div class="col-title title-cell" title="${escapeHtml(p.title)}"><span class="title-text">${highlight(p.title, v.terms)}</span>` +
    (p.hasPdf ? versionChipHtml(p.pdfVersion) : "") + tagChipsHtml(p.tags ?? [], v.terms) + chip + marksHtml(v.stats, p.note) + `</div>`;
}

function rowHtml(p: ListPaper, v: RowView, expanded: boolean): string {
  const venue = p.journal ?? p.publisher ?? "";
  // A blank leaf cell keeps the grid aligned when there is no twistie.
  const twistie = p.hasPdf
    ? `<div class="expand-btn${expanded ? "" : " collapsed"}" title="Attachments">${icon("chevron-down")}</div>`
    : `<div class="expand-btn leaf" aria-hidden="true"></div>`;
  const badge = `<button class="ls-badge ls-badge-${escapeHtml(p.status)}" data-cycle="1" title="Click to mark as ${STATUS_LABEL[nextStatus(p.status)]}">${escapeHtml(STATUS_LABEL[p.status] ?? p.status)}</button>`;
  return `<div class="paper-row-main">` + twistie + typeIconHtml(p, v.job, v.textLayer) + titleCell(p, v) +
      `<div class="col-meta col-creator" title="${escapeHtml((p.authors ?? []).join(", "))}">${highlight(formatAuthors(p.authors), v.terms)}</div>` +
      `<div class="col-meta">${p.year ? highlight(p.year, v.terms) : ""}</div>` +
      `<div class="col-meta col-pub" title="${escapeHtml(venue)}">${highlight(venue, v.terms)}</div>` +
      lastReadHtml(v.stats) +
      `<div class="col-meta">${badge}</div>` +
    `</div>` +
    (p.hasPdf
      ? `<div class="paper-children"><div class="child-row"><div></div><div class="paper-type-icon">${icon("file")}</div><div>${PDF_FILE}</div><div class="col-creator"></div><div></div><div class="col-pub"></div><div class="col-read"></div><div></div></div></div>`
      : "");
}

function wireMain(row: HTMLElement, p: ListPaper, h: RowHandlers): void {
  const main = row.querySelector<HTMLElement>(".paper-row-main")!;
  main.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const tag = target.closest<HTMLElement>(".row-tag[data-tag]");
    if (tag) { e.stopPropagation(); h.onSearchTag(tag.dataset["tag"]!); return; }
    if (target.closest(".loc-chip")) { e.stopPropagation(); h.onOpenFolder(p.folderPath); return; }
    if (target.closest("[data-cycle]")) { e.stopPropagation(); h.onCycleStatus(p); return; }
    h.onClick(p.id, e);
  });
  main.addEventListener("dblclick", (e) => {
    if (!(e.target as HTMLElement).closest("[data-cycle], .row-tag, .loc-chip")) h.onOpen(p.id);
  });
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); h.onMenu(p.id, e); });
}

/** Builds one paper row. Only a paper with a PDF can expand. */
export function buildPaperRow(p: ListPaper, v: RowView, h: RowHandlers): HTMLElement {
  const expanded = p.hasPdf && h.isExpanded(p.id);
  const row = el("div", { class: `paper-row${expanded ? " expanded" : ""}${p.hasPdf ? "" : " no-pdf"}`, "data-id": p.id, html: rowHtml(p, v, expanded) });
  row.draggable = true;
  const expandBtn = row.querySelector<HTMLElement>(".expand-btn:not(.leaf)");
  expandBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = row.classList.toggle("expanded");
    expandBtn.classList.toggle("collapsed", !open);
    h.setExpanded(p.id, open);
  });
  wireMain(row, p, h);
  row.querySelector(".child-row")?.addEventListener("click", (e) => { e.stopPropagation(); h.onOpen(p.id); });
  row.addEventListener("dragstart", (e) => h.onDragStart(p.id, e));
  row.addEventListener("dragend", h.onDragEnd);
  return row;
}
