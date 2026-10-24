/**
 * Renders the detail pane's text-layer banner: the call to make a scanned PDF searchable, or the progress of the
 * OCR running on it; for a selection, how many papers lack text or are being read.
 */
import { escapeHtml, icon } from "../../../../ui/index.js";
import { hasNoText, jobProgress, jobText } from "../../../viewModel/index.js";
import { fixableIds } from "../../flows/index.js";
import type { UiContext } from "../../uiContext.js";
import type { PaperView } from "../paneState.js";

function busyBanner(text: string, progress: number | null): string {
  return `<div class="tl-banner busy"><span class="tl-icon spin">${icon("loader")}</span><div class="tl-text">${escapeHtml(text)}` +
    (progress === null ? "" : `<div class="tl-progress"><progress max="100" value="${progress}"></progress></div>`) + `</div></div>`;
}

export function textLayerBanner(v: PaperView): string {
  if (v.job) return busyBanner(jobText(v.job), v.job.phase === "reading" ? jobProgress(v.job) : null);
  if (!hasNoText(v.p)) return "";
  const tl = v.p.textLayer!;
  const failed = tl.state === "failed";
  return `<div class="tl-banner"><span class="tl-icon">${icon("file-no-text")}</span><div class="tl-text">` +
    (failed ? "LabShelf could not add a text layer to this PDF." : "No text layer: search and text selection do not work in this PDF.") +
    (tl.reason ? `<div class="tl-reason">${escapeHtml(tl.reason)}</div>` : "") +
    `<button class="ls-btn ls-btn-primary tl-action" type="button" data-action="makeSearchable">${failed ? "Try again" : "Make searchable"}</button></div></div>`;
}

export function selectionBanner(ctx: UiContext, ids: string[]): string {
  const jobs = ctx.store.get().jobs;
  const busy = ids.filter((id) => jobs[id]).length;
  const todo = fixableIds(ctx, ids).length;
  if (!todo && !busy) return "";
  if (!todo) return busyBanner(`${busy} of these papers ${busy === 1 ? "is" : "are"} being made searchable…`, null);
  return `<div class="tl-banner"><span class="tl-icon">${icon("file-no-text")}</span><div class="tl-text">` +
    `${todo} of these papers ${todo === 1 ? "has" : "have"} no text layer.` +
    `<button class="ls-btn ls-btn-primary tl-action" type="button" data-action="makeSearchable">Make searchable</button></div></div>`;
}
