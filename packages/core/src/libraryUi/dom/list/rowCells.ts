/**
 * Renders the parts of a paper row that say more than the record: the state icon (no text layer, OCR running),
 * the PDF version chip, the Last read cell and the status mark.
 */
import { formatCompactTime } from "../../../time/index.js";
import { PDF_VERSION_LABEL, isPrePublication, type PdfVersion } from "../../../model/index.js";
import { STATUS_LABEL, deriveNextReadingStatus, type ReadingStatus } from "../../../library/record.js";
import { escapeHtml, renderIcon, renderReadingStatusMark } from "../../../ui/index.js";
import { hasMissingTextLayer, describeTextLayerJob, type ListPaper } from "../../viewModel/index.js";
import type { PaperStats, TextLayerJobView } from "../../protocol/index.js";

/** An icon after the title for a PDF that needs attention; a readable PDF shows none. */
export function renderTextLayerIconHtml(p: ListPaper, job: TextLayerJobView | undefined, textLayer: boolean): string {
  const cell = (cls: string, title: string, html: string): string =>
    `<span class="title-state ${cls}" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">${html}</span>`;
  if (job) return cell("tl-busy", describeTextLayerJob(job), `<span class="spin">${renderIcon("loader")}</span>`);
  // A missing PDF gets no icon: the detail pane says so and offers Find PDF.
  if (textLayer && hasMissingTextLayer(p)) {
    return cell("tl-missing", "No text layer: search and text selection do not work in this PDF. Select the paper to make it searchable.", renderIcon("file-no-text"));
  }
  return "";
}

const VERSION_HINT = {
  preprint: "This PDF is a preprint: the version before peer review.",
  accepted: "This PDF is the accepted manuscript: peer-reviewed, without the publisher's layout.",
} as const;

/** A "Preprint" or "Accepted" chip; the published version and an unknown one show none. */
export function renderVersionChipHtml(version: PdfVersion | null | undefined): string {
  return isPrePublication(version)
    ? `<span class="version-chip" title="${escapeHtml(VERSION_HINT[version])}">${PDF_VERSION_LABEL[version]}</span>`
    : "";
}

export function renderLastReadHtml(stats: PaperStats | undefined): string {
  const at = stats?.lastRead ? Date.parse(stats.lastRead) : NaN;
  if (!Number.isFinite(at)) return `<div class="col-meta col-read">—</div>`;
  const title = `Last read ${new Date(at).toLocaleString()}${stats?.lastPage ? `, page ${stats.lastPage}` : ""}`;
  return `<div class="col-meta col-read" title="${escapeHtml(title)}">${formatCompactTime(at)}</div>`;
}

/** A button that cycles the status, drawn as a dot for Unread and an Arc mark for Reading and Done, named by the status word. */
export function renderReadingStatusMarkHtml(status: ReadingStatus): string {
  return `<button class="status-mark s-${status}" data-cycle="1" title="Click to mark as ${STATUS_LABEL[deriveNextReadingStatus(status)]}">` +
    `<span class="status-mark-glyph" role="img" aria-label="${STATUS_LABEL[status]}">${renderReadingStatusMark(status)}</span></button>`;
}
