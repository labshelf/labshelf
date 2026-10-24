/**
 * Renders the File section: the PDF with its size and the host's open and reveal actions (or Find and Attach PDF when there
 * is none), the text-layer state, and when the paper was last read.
 */
import { PDF_FILE, formatBytes, formatDateTime, relativeTime } from "../../../../library/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import { textLayerSummary } from "../../../derive/index.js";
import { iconBtn, kv, muted } from "../detailMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";

function missingPdf(pane: PaneState): string {
  const { findPdf, attachPdf } = pane.ctx.caps;
  const actions = (findPdf ? `<button class="ls-btn" type="button" data-action="findPdf">${icon("search")}<span>Find PDF</span></button>` : "") +
    (attachPdf ? `<button class="ls-btn" type="button" data-action="attachPdf">${icon("paperclip")}<span>Attach PDF…</span></button>` : "");
  return muted("No PDF attached — this paper was saved without one.") + (actions ? `<div class="attach-actions">${actions}</div>` : "");
}

function pdfLine(pane: PaneState, v: PaperView): string {
  const caps = pane.ctx.caps;
  const pdf = v.details?.pdf;
  if (v.details && !pdf) return `<span class="muted-text">Not on this device yet</span>`;
  const link = `<button class="link-btn" type="button" data-action="open" title="${escapeHtml(pdf?.relPath ?? PDF_FILE)}">${PDF_FILE}</button>`;
  const size = pdf ? `<span class="muted-text">${formatBytes(pdf.size)}</span>` : `<span class="muted-text">…</span>`;
  return `<span class="kv-line">${link}${size}` +
    (caps.openExternal ? iconBtn("openExternal", "external", "Open in the default PDF app") : "") +
    (caps.reveal ? iconBtn("reveal", "folder", pane.ctx.labels.revealPaper ?? "Reveal folder") : "") + `</span>`;
}

function lastRead(v: PaperView): string {
  const at = v.stats?.lastRead;
  if (!at) return `<span class="muted-text">Never opened</span>`;
  return `<span title="${escapeHtml(formatDateTime(at))}">${escapeHtml(relativeTime(at))}${v.stats?.lastPage ? ` · page ${v.stats.lastPage}` : ""}</span>`;
}

export function fileSectionHtml(pane: PaneState, v: PaperView): string {
  if (!v.p.hasPdf) return missingPdf(pane);
  let html = kv("PDF", pdfLine(pane, v));
  if (pane.ctx.caps.textLayer) html += kv("Text", `<span class="tl-field">${escapeHtml(textLayerSummary(v.p, v.job))}</span>`);
  html += kv("Last read", lastRead(v));
  return `<div class="kv-grid">${html}</div>`;
}
