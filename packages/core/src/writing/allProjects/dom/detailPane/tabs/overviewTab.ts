// Builds the Overview tab of the All projects detail pane: target and limits, build, bibliography and location.
import { compactTime } from "../../../../../library/index.js";
import { iconBtn, kv, muted, section } from "../../../../../libraryUi/dom/index.js";
import { escapeHtml } from "../../../../../ui/index.js";
import type { CountedLimit, ProjectDetail } from "../../../projectDetailPane.js";
import type { ProjectRow } from "../../../projectRow.js";
import { bibliographyFact } from "../../tray/index.js";
import { buildStatusText, limitSentence, venueLine } from "../projectDetailPaneText.js";

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

function targetSection(row: ProjectRow, d: ProjectDetail, folds: Folds, now: number): string {
  const venue = venueLine(row.target, now);
  const pages = countedValue(d.limits.pages, d.pages);
  const words = countedValue(d.limits.words);
  const sentence = limitSentence(d.limits);
  const body = grid(
    kv("Venue", `<span class="kv-line"><span>${venue ? escapeHtml(venue) : "Not set"}</span>${iconBtn("editTarget", "edit", "Edit venue and deadline")}</span>`),
    pages ? kv("Pages", pages) : "",
    words ? kv("Words", words) : "",
  ) + limitBar(d.limits.pages) + (sentence ? muted(sentence) : "");
  return section("target", "Target & limits", body, folds);
}

function buildSection(row: ProjectRow, d: ProjectDetail, folds: Folds, now: number): string {
  const when = d.build.at === undefined ? undefined : `${compactTime(d.build.at, now)} ago`;
  const last = [buildStatusText(d.build), when, d.build.first?.message].filter(Boolean).map(escapeHtml).join(" · ");
  const body = grid(
    kv("Engine", d.engine ? escapeHtml(d.engine) : "Not set"),
    row.main ? kv("Main", code(row.main)) : "",
    kv("Last build", `<span class="ls-build-dot b-${d.build.state}"></span> ${last}`),
  ) + `<div class="build-actions">${button("build", "Build now")}${d.log ? button("openLog", "Open log") : ""}</div>`;
  return section("build", "Build", body, folds);
}

function bibliographySection(d: ProjectDetail, folds: Folds, now: number): string {
  const bib = d.bibliography;
  const body = bib ? grid(kv("File", code(bib.file))) + muted(bibliographyFact(bib, now)) : muted("No bibliography file.");
  return section("bibliography", "Bibliography", body, folds, bib ? { count: bib.entries } : {});
}

function locationSection(row: ProjectRow, d: ProjectDetail, folds: Folds): string {
  const body = grid(kv("Path", code(d.location)), kv("Folder", escapeHtml(row.folder ?? "Top level"))) +
    (row.external ? muted("Outside the library") : "");
  return section("location", "Location", body, { location: true, ...folds });
}

/** Location starts folded; `collapsed` holds the user's own folds and wins over that default. */
export function overviewTabHtml(row: ProjectRow, detail: ProjectDetail, collapsed: Record<string, boolean>, now: number): string {
  return targetSection(row, detail, collapsed, now) + buildSection(row, detail, collapsed, now) +
    bibliographySection(detail, collapsed, now) + locationSection(row, detail, collapsed);
}
