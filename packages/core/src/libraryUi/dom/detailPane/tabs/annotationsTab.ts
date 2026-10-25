/**
 * Renders the Annotations tab: highlights and notes by page, each opening the PDF at its page and copyable as a quote, with a
 * filter field past four, colour filters, Copy as Markdown and Export.
 */
import { formatRelativeTime } from "../../../../library/index.js";
import { ANNOTATION_COLORS, type Annotation } from "../../../../model/index.js";
import { byPageThenCreated } from "../../../../reader/index.js";
import { escapeHtml, renderIcon } from "../../../../ui/index.js";
import { renderIconButton, renderLoading, renderMuted } from "../detailPaneMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";

const FILTER_FROM = 5;

const annText = (a: Annotation): string => a.content.trim();

/** The annotations the filter field and the colour buttons let through, by page. */
export function deriveFilteredAnnotations(pane: PaneState, all: readonly Annotation[]): Annotation[] {
  const f = pane.annFilter.toLowerCase();
  return [...all].sort(byPageThenCreated).filter((a) => (!pane.annColor || a.color === pane.annColor) && (!f || annText(a).toLowerCase().includes(f)));
}

/** One annotation as a card that opens the PDF at its page. */
export function renderAnnotationCard(a: Annotation): string {
  const isNote = a.type !== "highlight";
  return `<div class="ann-card${a.color ? ` c-${a.color}` : ""}${isNote ? " is-note" : ""}" data-action="open" data-page="${a.pageNumber}" title="Open at page ${a.pageNumber}">` +
    (isNote ? `<span class="ann-kind">${renderIcon("note")}</span>` : "") +
    `<div class="ann-text">${escapeHtml(annText(a))}</div>` +
    `<div class="ann-meta"><span>p. ${a.pageNumber}</span><span class="muted-text">${escapeHtml(formatRelativeTime(a.createdAt))}</span><span class="tb-spacer"></span>` +
      renderIconButton("copyAnnotation", "copy", "Copy as a quote with its citation", ` data-id="${escapeHtml(a.id)}"`) + `</div></div>`;
}

export function renderAnnotationListHtml(pane: PaneState, all: readonly Annotation[]): string {
  const shown = deriveFilteredAnnotations(pane, all);
  if (!shown.length) return renderMuted("No annotation matches.");
  let html = "";
  let page = -1;
  for (const a of shown) {
    if (a.pageNumber !== page) { page = a.pageNumber; html += `<div class="ann-page">Page ${page}</div>`; }
    html += renderAnnotationCard(a);
  }
  return html;
}

function emptyTab(v: PaperView): string {
  return `<div class="tab-empty">${renderIcon("highlighter")}<div>No annotations yet.</div><div class="muted-text">Highlights and notes you make in the reader appear here, by page.</div>` +
    (v.p.hasPdf ? `<button class="ls-btn ls-btn-primary" type="button" data-action="open">${renderIcon("book-open")}<span>Open PDF</span></button>` : "") + `</div>`;
}

function toolbar(pane: PaneState, all: readonly Annotation[]): string {
  const colors = ANNOTATION_COLORS.filter((c) => all.some((a) => a.color === c));
  const count = all.length >= FILTER_FROM
    ? `<input class="mini-input ann-filter" placeholder="Filter ${all.length} annotations" value="${escapeHtml(pane.annFilter)}" spellcheck="false" aria-label="Filter annotations"/>`
    : `<span class="muted-text">${all.length} annotation${all.length === 1 ? "" : "s"}</span><span class="tb-spacer"></span>`;
  const swatches = colors.length > 1 ? colors.map((c) =>
    `<button class="ann-color c-${c}${pane.annColor === c ? " on" : ""}" type="button" data-action="annColor" data-color="${c}" title="Only ${c} highlights" aria-pressed="${pane.annColor === c}"></button>`).join("") : "";
  return `<div class="tab-toolbar">${count}${swatches}` + renderIconButton("copyAnnotations", "copy", "Copy these as Markdown") +
    renderIconButton("exportAnnotations", "download", "Export to a Markdown file…") + `</div>`;
}

export function renderAnnotationsTabHtml(pane: PaneState, v: PaperView): string {
  if (!v.details) return renderLoading("Loading annotations…");
  const all = v.details.annotations;
  if (!all.length) return emptyTab(v);
  return toolbar(pane, all) + `<div class="ann-list">${renderAnnotationListHtml(pane, all)}</div>`;
}
