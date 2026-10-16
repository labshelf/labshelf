/**
 * Renders the parts of a paper row that say more than the record: the type icon (PDF, no PDF, no text layer, OCR
 * running), the PDF version chip, tag chips, the annotation and note marks, the Last read cell and the status mark.
 */
import { compactTime } from "../../../library/index.js";
import { PDF_VERSION_LABEL, STATUS_LABEL, isPrePublication, nextStatus, type PaperStatus, type PdfVersion } from "../../../model/index.js";
import { STATUS_ARC, arcMark, escapeHtml, icon } from "../../../ui/index.js";
import { highlight } from "../../../ui/dom/index.js";
import { hasNoText, jobText, type ListPaper } from "../../derive/index.js";
import type { PaperStats, TextLayerJobView } from "../../protocol/index.js";

const SHOWN_TAGS = 3;

export function typeIconHtml(p: ListPaper, job: TextLayerJobView | undefined, textLayer: boolean): string {
  const cell = (cls: string, title: string, html: string): string =>
    `<div class="paper-type-icon${cls ? ` ${cls}` : ""}"${title ? ` title="${escapeHtml(title)}"` : ""}>${html}</div>`;
  if (job) return cell("tl-busy", jobText(job), `<span class="spin">${icon("loader")}</span>`);
  if (!p.hasPdf) return cell("no-pdf", "No PDF: this paper was saved without one.", icon("file-minus"));
  if (textLayer && hasNoText(p)) {
    return cell("tl-missing", "No text layer: search and text selection do not work in this PDF. Select the paper to make it searchable.", icon("file-no-text"));
  }
  return cell("", "", icon("file"));
}

const VERSION_HINT = {
  preprint: "This PDF is a preprint: the version before peer review.",
  accepted: "This PDF is the accepted manuscript: peer-reviewed, without the publisher's layout.",
} as const;

/** A "Preprint" or "Accepted" chip; the published version and an unknown one show none. */
export function versionChipHtml(version: PdfVersion | null | undefined): string {
  return isPrePublication(version)
    ? `<span class="version-chip" title="${escapeHtml(VERSION_HINT[version])}">${PDF_VERSION_LABEL[version]}</span>`
    : "";
}

/** Up to three tag chips that search their tag, then a "+N" chip naming the rest. */
export function tagChipsHtml(tags: readonly string[], terms: string[]): string {
  const shown = tags.slice(0, SHOWN_TAGS).map((t) =>
    `<span class="row-tag" data-tag="${escapeHtml(t)}" title="Show papers tagged ${escapeHtml(t)}">${highlight(t, terms)}</span>`).join("");
  const rest = tags.slice(SHOWN_TAGS);
  return shown + (rest.length ? `<span class="row-tag more" title="${escapeHtml(rest.join(", "))}">+${rest.length}</span>` : "");
}

export function marksHtml(stats: PaperStats | undefined, note: string | undefined): string {
  const n = stats?.annotations ?? 0;
  const marks = (n ? `<span class="row-mark" title="${n} annotation${n === 1 ? "" : "s"}">${icon("highlighter")}${n}</span>` : "") +
    (note?.trim() ? `<span class="row-mark" title="Has a note">${icon("note")}</span>` : "");
  return marks ? `<span class="row-marks">${marks}</span>` : "";
}

export function lastReadHtml(stats: PaperStats | undefined): string {
  const at = stats?.lastRead ? Date.parse(stats.lastRead) : NaN;
  if (!Number.isFinite(at)) return `<div class="col-meta col-read">—</div>`;
  const title = `Last read ${new Date(at).toLocaleString()}${stats?.lastPage ? `, page ${stats.lastPage}` : ""}`;
  return `<div class="col-meta col-read" title="${escapeHtml(title)}">${compactTime(at)}</div>`;
}

/** A button that cycles the status, drawn as a dot for Unread and an Arc mark for Reading and Done, named by the status word. */
export function statusMarkHtml(status: PaperStatus): string {
  const mark = status === "unread" ? `<span class="ls-status-dot"></span>` : arcMark(...STATUS_ARC[status]);
  return `<button class="status-mark s-${status}" data-cycle="1" title="Click to mark as ${STATUS_LABEL[nextStatus(status)]}">` +
    `<span class="status-mark-glyph" role="img" aria-label="${STATUS_LABEL[status]}">${mark}</span></button>`;
}
