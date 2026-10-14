/**
 * One paper row: a twistie and a PDF child row when the paper has a PDF (otherwise an aligned blank cell and a muted
 * file-minus icon), the title with a location chip when the paper sits in a subfolder, creator, year, publication,
 * and a status badge that cycles on click.
 */
import { PDF_FILE, formatAuthors } from "../../../library/index.js";
import { STATUS_LABEL, nextStatus } from "../../../model/index.js";
import { el, highlight } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { ListPaper } from "../../derive/index.js";

export interface RowHandlers {
  onClick: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onCycleStatus: (p: ListPaper) => void;
  onOpenFolder: (folder: string) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  isExpanded: (id: string) => boolean;
  setExpanded: (id: string, open: boolean) => void;
}

function rowHtml(p: ListPaper, terms: string[], expanded: boolean): string {
  const venue = p.journal ?? p.publisher ?? "";
  const chip = p.relFolder ? `<span class="loc-chip" title="Go to ${escapeHtml(p.relFolder)}">${highlight(p.relFolder, terms)}</span>` : "";
  // A blank leaf cell keeps the grid aligned when there is no twistie.
  const twistie = p.hasPdf
    ? `<div class="expand-btn${expanded ? "" : " collapsed"}" title="Attachments">${icon("chevron-down")}</div>`
    : `<div class="expand-btn leaf" aria-hidden="true"></div>`;
  const typeIcon = p.hasPdf
    ? `<div class="paper-type-icon">${icon("file")}</div>`
    : `<div class="paper-type-icon" title="No PDF attached">${icon("file-minus")}</div>`;
  const badge = `<button class="ls-badge ls-badge-${escapeHtml(p.status)}" data-cycle="1" title="Click to mark as ${STATUS_LABEL[nextStatus(p.status)]}">${escapeHtml(STATUS_LABEL[p.status] ?? p.status)}</button>`;
  return `<div class="paper-row-main">` + twistie + typeIcon +
      `<div class="col-title title-cell" title="${escapeHtml(p.title)}"><span class="title-text">${highlight(p.title, terms)}</span>${chip}</div>` +
      `<div class="col-meta" title="${escapeHtml((p.authors ?? []).join(", "))}">${highlight(formatAuthors(p.authors), terms)}</div>` +
      `<div class="col-meta">${p.year ? highlight(p.year, terms) : ""}</div>` +
      `<div class="col-meta col-pub" title="${escapeHtml(venue)}">${highlight(venue, terms)}</div>` +
      `<div class="col-meta">${badge}</div>` +
    `</div>` +
    (p.hasPdf
      ? `<div class="paper-children"><div class="child-row"><div></div><div class="paper-type-icon">${icon("file")}</div><div>${PDF_FILE}</div><div></div><div></div><div class="col-pub"></div><div></div></div></div>`
      : "");
}

/** Builds one paper row. Only a paper with a PDF can expand. */
export function buildPaperRow(p: ListPaper, terms: string[], h: RowHandlers): HTMLElement {
  const expanded = p.hasPdf && h.isExpanded(p.id);
  const row = el("div", { class: `paper-row${expanded ? " expanded" : ""}${p.hasPdf ? "" : " no-pdf"}`, "data-id": p.id, html: rowHtml(p, terms, expanded) });
  row.draggable = true;
  const expandBtn = row.querySelector<HTMLElement>(".expand-btn:not(.leaf)");
  expandBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = row.classList.toggle("expanded");
    expandBtn.classList.toggle("collapsed", !open);
    h.setExpanded(p.id, open);
  });
  const main = row.querySelector<HTMLElement>(".paper-row-main")!;
  main.addEventListener("click", (e) => h.onClick(p.id, e));
  main.addEventListener("dblclick", () => h.onOpen(p.id));
  row.querySelector(".child-row")?.addEventListener("click", (e) => { e.stopPropagation(); h.onOpen(p.id); });
  const badge = row.querySelector<HTMLElement>("[data-cycle]")!;
  badge.addEventListener("click", (e) => { e.stopPropagation(); h.onCycleStatus(p); });
  badge.addEventListener("dblclick", (e) => e.stopPropagation());
  row.querySelector(".loc-chip")?.addEventListener("click", (e) => { e.stopPropagation(); h.onOpenFolder(p.folderPath); });
  row.addEventListener("dragstart", (e) => h.onDragStart(p.id, e));
  row.addEventListener("dragend", h.onDragEnd);
  return row;
}
