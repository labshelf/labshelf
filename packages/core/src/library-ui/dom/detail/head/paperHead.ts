/**
 * Renders the head of a single paper's detail: what it is (title, authors that search their name, the venue line),
 * what you reach for most (open or continue, copy key, copy citation, move, the paper menu), its status and tags.
 */
import { familyName, venueLine } from "../../../../library/index.js";
import { isPrePublication } from "../../../../model/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import { ASK_AUTHOR_LABEL, pdfRequestedLine } from "../../../pdfCopy.js";
import { CITE_LABEL } from "../../flows/index.js";
import { versionChipHtml } from "../../list/index.js";
import { KEY_HINT } from "../../uiContext.js";
import { iconBtn, statusSeg } from "../detailMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";
import { tagRowHtml } from "./tagRow.js";
import { textLayerBanner } from "./textLayerBanner.js";

const FOLD_AUTHORS_ABOVE = 5;
const FOLDED_AUTHORS = 3;

function bylineHtml(pane: PaneState, authors: readonly string[]): string {
  const shown = pane.authorsOpen || authors.length <= FOLD_AUTHORS_ABOVE ? authors : authors.slice(0, FOLDED_AUTHORS);
  const names = shown.map((a) =>
    `<button class="link-btn" type="button" data-action="searchAuthor" data-q="${escapeHtml(familyName(a))}" title="Show papers by ${escapeHtml(a)}">${escapeHtml(a)}</button>`).join(", ");
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
    return `<button class="ls-btn ls-btn-primary open-btn" type="button" data-action="open" title="${title}">${icon("book-open")}<span>${lastPage > 1 ? `Continue · p. ${lastPage}` : "Open PDF"}</span></button>` +
      (caps.findPdf && isPrePublication(v.p.pdfVersion) ? findBetterButton(v.pdfBusy) : "");
  }
  const find = caps.findPdf
    ? `<button class="ls-btn ls-btn-primary open-btn" type="button" data-action="findPdf"${v.pdfBusy ? " disabled" : ""}>${v.pdfBusy ? `<span class="spin">${icon("refresh")}</span><span>Searching…</span>` : `${icon("search")}<span>Find PDF</span>`}</button>`
    : `<button class="ls-btn open-btn" type="button" disabled title="This paper has no PDF">${icon("file-minus")}<span>No PDF</span></button>`;
  const attach = caps.attachPdf ? `<button class="ls-btn" type="button" data-action="attachPdf">${icon("paperclip")}<span>Attach PDF…</span></button>` : "";
  const ask = caps.askAuthor ? `<button class="ls-btn" type="button" data-action="askAuthor">${icon("mail")}<span>${ASK_AUTHOR_LABEL}</span></button>` : "";
  return find + attach + ask;
}

function findBetterButton(busy: boolean): string {
  return `<button class="ls-btn" type="button" data-action="findBetterPdf"${busy ? " disabled" : ""}>` +
    (busy ? `<span class="spin">${icon("refresh")}</span><span>Searching…</span>` : `${icon("search")}<span>Find Published Version</span>`) + `</button>`;
}

export function paperHeadHtml(pane: PaneState, v: PaperView): string {
  const { p } = v;
  const meta = venueLine(p);
  const version = p.hasPdf ? versionChipHtml(p.pdfVersion) : "";
  return `<div class="detail-head">` +
    `<div class="detail-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>` +
    (p.authors?.length ? bylineHtml(pane, p.authors) : "") +
    (meta || version ? `<div class="detail-meta">${version}${escapeHtml(meta)}</div>` : "") +
    (!p.hasPdf && p.pdfRequestedAt ? `<div class="detail-meta">${escapeHtml(pdfRequestedLine(p.pdfRequestedAt))}</div>` : "") +
    `<div class="detail-toolbar">${primaryButtons(pane, v)}<span class="tb-spacer"></span>` +
      iconBtn("copyKey", "key", `Copy cite key ${p.citeKey} (${KEY_HINT.mod}C)`) +
      iconBtn("copyCite", "quote", `Copy citation as ${CITE_LABEL[pane.citeFormat]} — pick the style under Cite`) +
      iconBtn("move", "folder-move", "Move to folder…") +
      iconBtn("more", "more", "More actions") +
    `</div>` +
    statusSeg(p.status) + tagRowHtml(pane.ctx, p.tags ?? []) + (pane.ctx.caps.textLayer ? textLayerBanner(v) : "") +
  `</div>`;
}
