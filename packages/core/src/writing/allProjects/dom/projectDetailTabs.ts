// Builds the detail pane's tabs and their sentences: the tab list, the Overview, Citations and Versions bodies, and the meta, venue, limit and build texts.
import { formatCompactTime } from "../../../time/index.js";
import { renderIconButton, renderField, renderMuted, renderSection, type TabSpec } from "../../../libraryUi/dom/index.js";
import { escapeHtml, formatCount } from "../../../ui/index.js";
import type { ProjectSubmission } from "../../project/index.js";
import {
  countDaysUntil,
  type CountedLimit, type ProjectBuildState, type ProjectCitation, type ProjectPaneContent, type ProjectRow,
} from "../projectModel.js";
import { deriveBibliographyFact } from "./projectTray.js";

const FORMAT_NAME = { latex: "LaTeX", typst: "Typst" } as const;
const BUILD_STATUS: Record<ProjectBuildState, string> = {
  ok: "Built", warnings: "Built, with warnings", failed: "Build failed", building: "Building", earlier: "Built", never: "Never built",
};

/** "LaTeX · main.tex · 8 pages · modified 2 h ago", with only the parts the row and the detail know. */
export function formatMetaLine(row: ProjectRow, pages: number | undefined, now: number): string {
  const modified = row.modified === undefined ? undefined : formatCompactTime(row.modified, now);
  return [
    row.format && FORMAT_NAME[row.format],
    row.main,
    pages !== undefined && formatCount(pages, "page"),
    modified && (modified === "now" ? "modified just now" : `modified ${modified} ago`),
  ].filter(Boolean).join(" · ");
}

/** "ICLR 2027 · due in 41 days"; the venue or the deadline alone when the other is unset. */
export function formatProjectVenueLine(target: ProjectSubmission | undefined, now: number): string | undefined {
  const days = countDaysUntil(target, now);
  const due = days === undefined ? undefined : days < 0 ? "deadline passed" : days === 0 ? "due today" : `due in ${formatCount(days, "day")}`;
  const line = [target?.venue, due].filter(Boolean).join(" · ");
  return line || undefined;
}

function withLimit(c: CountedLimit | undefined, noun: string): { counted: number; limit: number; noun: string } | undefined {
  return c?.limit === undefined ? undefined : { counted: c.counted, limit: c.limit, noun };
}

/** "1 page left · counted up to the references"; a page limit wins over a word limit, and no limit gives no sentence. */
export function describeLimits(limits: ProjectPaneContent["limits"]): string | undefined {
  const counted = withLimit(limits.pages, "page") ?? withLimit(limits.words, "word");
  if (!counted) return undefined;
  const left = counted.limit - counted.counted;
  const head = left > 0 ? `${formatCount(left, counted.noun)} left` : left === 0 ? "At the limit" : `${formatCount(-left, counted.noun)} over`;
  return `${head} · counted ${limits.countUpTo === "references" ? "up to the references" : "to the end"}`;
}

/** "2 warnings" when the count is known, else the state's name; no mark reads as never built. */
export function formatProjectBuildStateText(build: { state: ProjectBuildState; warnings?: number } | undefined): string {
  if (!build) return BUILD_STATUS.never;
  if (build.state === "warnings" && build.warnings !== undefined) return formatCount(build.warnings, "warning");
  return BUILD_STATUS[build.state];
}

const tab = (id: string, label: string, n: number | undefined): TabSpec => (n ? { id, label, badge: String(n) } : { id, label });

export function deriveProjectPaneTabs(detail: ProjectPaneContent | undefined): TabSpec[] {
  return [tab("overview", "Overview", undefined), tab("citations", "Citations", detail?.citations.length), tab("versions", "Versions", detail?.versions.length)];
}

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

function citationRow(c: ProjectCitation, bibFile: string | undefined): string {
  const missing = c.source === "none" ? `<span class="cite-missing">Not found</span>` : "";
  const text = [c.title, c.authors, c.year].filter(Boolean).map(escapeHtml).join(" · ");
  const from = c.source === "bib" && bibFile ? `<span class="cite-source">from ${escapeHtml(bibFile)}</span>` : "";
  return `<div class="ls-cite-row${missing ? " missing" : ""}" role="listitem">${missing}<span class="cite-key">${escapeHtml(c.key)}</span>` +
    (text ? `<span class="cite-text">${text}</span>` : "") + from + `</div>`;
}

export function renderCitationsTabHtml(detail: ProjectPaneContent): string {
  if (detail.citations.length === 0) return renderMuted("No citations yet.");
  return `<div class="ls-cite-list" role="list">${detail.citations.map((c) => citationRow(c, detail.bibliography?.file)).join("")}</div>`;
}

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
