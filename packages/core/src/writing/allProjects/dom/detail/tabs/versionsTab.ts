// Builds the Versions tab of the All projects detail pane: one row per saved version, newest first.
import { compactTime } from "../../../../../library/index.js";
import { muted } from "../../../../../libraryUi/dom/index.js";
import { escapeHtml } from "../../../../../ui/index.js";
import type { ProjectDetail } from "../../../projectDetail.js";

function versionRow(v: ProjectDetail["versions"][number], now: number): string {
  const at = Date.parse(v.created);
  const age = Number.isNaN(at) ? v.created : compactTime(at, now);
  return `<div class="ls-version-row" role="listitem"><span class="version-name">${escapeHtml(v.name)}</span>` +
    `<span class="version-time" title="${escapeHtml(v.created)}">${escapeHtml(age)}</span></div>`;
}

export function versionsTabHtml(versions: ProjectDetail["versions"], now: number): string {
  if (versions.length === 0) return muted("No versions yet.");
  return `<div class="ls-version-list" role="list">${versions.map((v) => versionRow(v, now)).join("")}</div>`;
}
