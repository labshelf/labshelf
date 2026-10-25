/**
 * Renders the head of a single paper's detail: what it is (title, authors that search their name, the venue line),
 * what you reach for most (open or continue, Cite, the corner More actions menu), its status and tags.
 */
import { PAPERS_DIR, deriveFamilyName, deriveParentDir, formatVenueLine } from "../../../../library/index.js";
import { isPrePublication } from "../../../../model/index.js";
import { escapeHtml, renderIcon } from "../../../../ui/index.js";
import { ASK_AUTHOR_LABEL, formatPdfRequestedLine } from "../../../pdfCopy.js";
import { renderVersionChipHtml } from "../../list/index.js";
import type { PaneState, PaperView } from "../paneState.js";
import { renderCitationMenuButton, renderMoreMenuButton, renderReadingStatusMenuButton } from "./headMenus.js";
import { renderTagRowHtml } from "./tagRow.js";
import { renderTextLayerBanner } from "./renderTextLayerBanner.js";

const FOLD_AUTHORS_ABOVE = 5;
const FOLDED_AUTHORS = 3;

function bylineHtml(pane: PaneState, authors: readonly string[]): string {
  const shown = pane.authorsOpen || authors.length <= FOLD_AUTHORS_ABOVE ? authors : authors.slice(0, FOLDED_AUTHORS);
  const names = shown.map((a) =>
    `<button class="link-btn" type="button" data-action="searchAuthor" data-q="${escapeHtml(deriveFamilyName(a))}" title="Show papers by ${escapeHtml(a)}">${escapeHtml(a)}</button>`).join(", ");
  const more = authors.length > shown.length
    ? ` <button class="link-btn more" type="button" data-action="toggleAuthors">+${authors.length - shown.length} more</button>`
    : pane.authorsOpen && authors.length > FOLD_AUTHORS_ABOVE ? ` <button class="link-btn more" type="button" data-action="toggleAuthors">less</button>` : "";
  return `<div class="detail-byline">${names}${more}</div>`;
}

/**
 * Open PDF (or Continue at the last page), plus Find Published Version for a preprint where the host can search;
 * without a PDF, Find PDF, Attach PDF and Ask the author where the host can, else a disabled "No PDF".
 */
function primaryButtons(pane: PaneState, v: PaperView): string {
  const caps = pane.ctx.caps;
  const lastPage = v.stats?.lastPage ?? 0;
  if (v.p.hasPdf) {
    const title = `Open in the reader (Enter)${lastPage > 1 ? " — it reopens where you left off" : ""}`;
    return `<button class="ls-btn ls-button-soft open-btn" type="button" data-action="open" title="${title}">${renderIcon("book-open")}<span>${lastPage > 1 ? `Continue · p. ${lastPage}` : "Open PDF"}</span></button>` +
      (caps.findPdf && isPrePublication(v.p.pdfVersion) ? findBetterButton(v.pdfBusy) : "");
  }
  const find = caps.findPdf
    ? `<button class="ls-btn ls-button-soft open-btn" type="button" data-action="findPdf"${v.pdfBusy ? " disabled" : ""}>${v.pdfBusy ? `<span class="spin">${renderIcon("refresh")}</span><span>Searching…</span>` : `${renderIcon("search")}<span>Find PDF</span>`}</button>`
    : `<button class="ls-btn ls-button-soft open-btn" type="button" disabled title="This paper has no PDF">${renderIcon("file-minus")}<span>No PDF</span></button>`;
  const attach = caps.attachPdf ? `<button class="ls-btn" type="button" data-action="attachPdf">${renderIcon("paperclip")}<span>Attach PDF…</span></button>` : "";
  const ask = caps.askAuthor ? `<button class="ls-btn" type="button" data-action="askAuthor">${renderIcon("mail")}<span>${ASK_AUTHOR_LABEL}</span></button>` : "";
  return find + attach + ask;
}

function findBetterButton(busy: boolean): string {
  return `<button class="ls-btn" type="button" data-action="findBetterPdf"${busy ? " disabled" : ""}>` +
    (busy ? `<span class="spin">${renderIcon("refresh")}</span><span>Searching…</span>` : `${renderIcon("search")}<span>Find Published Version</span>`) + `</button>`;
}

// The meta line reads venue, version, then the paper's folder (a chevron and its name, which opens it) unless the paper sits at the library root.
function metaHtml(p: PaperView["p"], version: string): string {
  const dir = deriveParentDir(p.path, "/");
  const folder = dir === PAPERS_DIR ? ""
    : `<button class="link-btn" type="button" data-action="goFolder">${renderIcon("chevron-right")}${escapeHtml(dir.slice(dir.lastIndexOf("/") + 1))}</button>`;
  const text = [escapeHtml(formatVenueLine(p)), version].filter(Boolean).join(" · ");
  const line = [text, folder].filter(Boolean).join(" · ");
  return line ? `<div class="detail-meta">${line}</div>` : "";
}

export function renderPaperHeadHtml(pane: PaneState, v: PaperView): string {
  const { p } = v;
  const version = p.hasPdf ? renderVersionChipHtml(p.pdfVersion) : "";
  return `<div class="detail-head">` + renderMoreMenuButton() +
    `<div class="detail-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>` +
    (p.authors?.length ? bylineHtml(pane, p.authors) : "") +
    metaHtml(p, version) +
    (!p.hasPdf && p.pdfRequestedAt ? `<div class="detail-meta">${escapeHtml(formatPdfRequestedLine(p.pdfRequestedAt))}</div>` : "") +
    `<div class="detail-toolbar">${primaryButtons(pane, v)}${renderCitationMenuButton()}</div>` +
    `<div class="detail-status-row">${renderReadingStatusMenuButton(p.status)}${renderTagRowHtml(pane.ctx, p.tags ?? [], pane.tagEditing)}</div>` +
    (pane.ctx.caps.textLayer ? renderTextLayerBanner(v) : "") +
  `</div>`;
}
