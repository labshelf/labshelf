// Builds the head of the All projects detail pane: title, meta line, Open and Preview buttons, build status and target.
import { iconBtn } from "../../../../library-ui/dom/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import { deadlineText } from "../../deadlineText.js";
import type { ProjectDetail } from "../../projectDetail.js";
import type { ProjectRow } from "../../projectRow.js";
import { buildStatusText, metaLine } from "./projectDetailText.js";

export interface ProjectHeadOptions {
  /** The host's label for the primary button, such as "Open in VS Code". */
  openLabel: string;
  now: number;
}

function targetMark(row: ProjectRow, now: number): string {
  const left = deadlineText(row.target, now);
  const text = [row.target?.venue, left?.text].filter(Boolean).join(" · ");
  if (!text) return "";
  const tone = left && left.tone !== "normal" ? ` tone-${left.tone}` : "";
  return `<span class="status-target${tone}">${icon("target")}<span>${escapeHtml(text)}</span></span>`;
}

/** The status comes from the row until the detail, which knows the warning count, arrives. */
export function projectDetailHeadHtml(row: ProjectRow, detail: ProjectDetail | undefined, o: ProjectHeadOptions): string {
  const build = detail?.build ?? row.build;
  return `<div class="detail-head">` +
    `<div class="head-more">${iconBtn("more", "more", "More actions")}</div>` +
    `<div class="detail-title">${escapeHtml(row.title)}</div>` +
    `<div class="detail-meta">${escapeHtml(metaLine(row, detail?.pages, o.now))}</div>` +
    `<div class="detail-toolbar">` +
      `<button class="ls-btn ls-button-soft open-btn" type="button" data-action="open">${escapeHtml(o.openLabel)}</button>` +
      `<button class="ls-btn ls-btn-ghost" type="button" data-action="preview">Preview</button>` +
    `</div>` +
    `<div class="detail-status-row">` +
      `<span class="status-build"><span class="ls-build-dot b-${build?.state ?? "never"}"></span>${escapeHtml(buildStatusText(build))}</span>` +
      targetMark(row, o.now) +
    `</div></div>`;
}
