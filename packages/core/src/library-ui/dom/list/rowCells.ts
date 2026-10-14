/**
 * The parts of a paper row that say more than the record: the type icon (PDF, no PDF, no text layer, OCR running),
 * tag chips, the annotation and note marks, and the Last read cell.
 */
import { formatDateTime, relativeTime } from "../../../library/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
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
  const at = stats?.lastRead;
  const title = at ? ` title="Last read ${escapeHtml(formatDateTime(at))}${stats?.lastPage ? `, page ${stats.lastPage}` : ""}"` : "";
  return `<div class="col-meta col-read"${title}>${escapeHtml(relativeTime(at))}</div>`;
}
