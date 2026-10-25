// Builds the Versions tab of the All projects detail pane: one row per saved version, newest first.
import { formatCompactTime } from "../../../../../library/index.js";
import { renderMuted } from "../../../../../libraryUi/dom/index.js";
import { escapeHtml } from "../../../../../ui/index.js";
import type { ProjectPaneContent } from "../../../projectDetailPane.js";

function versionRow(v: ProjectPaneContent["versions"][number], now: number): string {
  const at = Date.parse(v.created);
  const age = Number.isNaN(at) ? v.created : formatCompactTime(at, now);
  return `<div class="ls-version-row" role="listitem"><span class="version-name">${escapeHtml(v.name)}</span>` +
    `<span class="version-time" title="${escapeHtml(v.created)}">${escapeHtml(age)}</span></div>`;
}

export function renderVersionsTabHtml(versions: ProjectPaneContent["versions"], now: number): string {
  if (versions.length === 0) return renderMuted("No versions yet.");
  return `<div class="ls-version-list" role="list">${versions.map((v) => versionRow(v, now)).join("")}</div>`;
}
