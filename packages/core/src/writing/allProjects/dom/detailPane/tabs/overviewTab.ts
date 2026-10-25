// Builds the Overview tab of the All projects detail pane: target and limits, build, bibliography and location.
import { formatCompactTime } from "../../../../../library/index.js";
import { renderIconButton, renderField, renderMuted, renderSection } from "../../../../../libraryUi/dom/index.js";
import { escapeHtml } from "../../../../../ui/index.js";
import type { CountedLimit, ProjectPaneContent } from "../../../projectDetailPane.js";
import type { ProjectRow } from "../../../projectRow.js";
import { deriveBibliographyFact } from "../../tray/index.js";
import { formatProjectBuildStateText, describeLimits, formatProjectVenueLine } from "../projectDetailPaneText.js";

type Folds = Record<string, boolean>;

const count = (n: number): string => n.toLocaleString("en-US");
const grid = (...rows: string[]): string => `<div class="kv-grid">${rows.join("")}</div>`;
const code = (text: string): string => `<code>${escapeHtml(text)}</code>`;
const button = (action: string, label: string): string => `<button class="ls-btn ls-btn-ghost" type="button" data-action="${action}">${label}</button>`;

function countedValue(c: CountedLimit | undefined, fallback?: number): string | undefined {
  if (!c) return fallback === undefined ? undefined : count(fallback);
  return c.limit === undefined ? count(c.counted) : `${count(c.counted)} / ${count(c.limit)}`;
}

/** Fills in proportion to the limit and is flagged at and past it; an unset or zero limit draws no bar. */
function limitBar(c: CountedLimit | undefined): string {
  if (!c?.limit) return "";
  const mod = c.counted > c.limit ? " past-limit" : c.counted === c.limit ? " at-limit" : "";
  const pct = Math.min(100, Math.round((c.counted / c.limit) * 100));
  return `<div class="ls-limit-bar${mod}" role="progressbar" aria-valuemin="0" aria-valuemax="${c.limit}" aria-valuenow="${c.counted}">` +
    `<div class="ls-limit-fill" style="width:${pct}%"></div></div>`;
}

function targetSection(row: ProjectRow, d: ProjectPaneContent, folds: Folds, now: number): string {
  const venue = formatProjectVenueLine(row.target, now);
  const pages = countedValue(d.limits.pages, d.pages);
  const words = countedValue(d.limits.words);
  const sentence = describeLimits(d.limits);
  const body = grid(
    renderField("Venue", `<span class="kv-line"><span>${venue ? escapeHtml(venue) : "Not set"}</span>${renderIconButton("editTarget", "edit", "Edit venue and deadline")}</span>`),
    pages ? renderField("Pages", pages) : "",
    words ? renderField("Words", words) : "",
  ) + limitBar(d.limits.pages) + (sentence ? renderMuted(sentence) : "");
  return renderSection("target", "Target & limits", body, folds);
}

function buildSection(row: ProjectRow, d: ProjectPaneContent, folds: Folds, now: number): string {
  const when = d.build.at === undefined ? undefined : `${formatCompactTime(d.build.at, now)} ago`;
  const last = [formatProjectBuildStateText(d.build), when, d.build.first?.message].filter(Boolean).map(escapeHtml).join(" · ");
  const body = grid(
    renderField("Engine", d.engine ? escapeHtml(d.engine) : "Not set"),
    row.main ? renderField("Main", code(row.main)) : "",
    renderField("Last build", `<span class="ls-build-dot b-${d.build.state}"></span> ${last}`),
  ) + `<div class="build-actions">${button("build", "Build now")}${d.log ? button("openLog", "Open log") : ""}</div>`;
  return renderSection("build", "Build", body, folds);
}

function bibliographySection(d: ProjectPaneContent, folds: Folds, now: number): string {
  const bib = d.bibliography;
  const body = bib ? grid(renderField("File", code(bib.file))) + renderMuted(deriveBibliographyFact(bib, now)) : renderMuted("No bibliography file.");
  return renderSection("bibliography", "Bibliography", body, folds, bib ? { count: bib.entries } : {});
}

function locationSection(row: ProjectRow, d: ProjectPaneContent, folds: Folds): string {
  const body = grid(renderField("Path", code(d.location)), renderField("Folder", escapeHtml(row.folder ?? "Top level"))) +
    (row.external ? renderMuted("Outside the library") : "");
  return renderSection("location", "Location", body, { location: true, ...folds });
}

/** Location starts folded; `collapsed` holds the user's own folds and wins over that default. */
export function renderOverviewTabHtml(row: ProjectRow, detail: ProjectPaneContent, collapsed: Record<string, boolean>, now: number): string {
  return targetSection(row, detail, collapsed, now) + buildSection(row, detail, collapsed, now) +
    bibliographySection(detail, collapsed, now) + locationSection(row, detail, collapsed);
}
