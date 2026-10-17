// Builds one project as a treegrid row: files twistie, title with venue chip, engine, cites, build dot, last modified (or trashed) time and the actions button.
import { compactTime } from "../../../library/index.js";
import { formatLabel } from "../../../library-ui/dom/index.js";
import { el, highlight } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { deadlineText } from "../deadlineText.js";
import type { BuildMark, ProjectBuildState, ProjectPlace, ProjectRow } from "../projectRow.js";

export interface ProjectRowView {
  place: ProjectPlace;
  terms: string[];
  now: number;
}

/** The ISO time the date column shows: when the project went to the trash there, its newest source file elsewhere. */
function shownTime(row: ProjectRow, place: ProjectPlace): string | undefined {
  if (place === "trash") return row.trashedAt;
  return row.modified === undefined ? undefined : new Date(row.modified).toISOString();
}

// A broken project has no files to list, so its first cell stays empty.
const twistieCell = (row: ProjectRow): string =>
  row.broken ? `<div></div>` : `<div class="expand-btn collapsed" title="Files">${icon("chevron-down")}</div>`;

function engineCell(row: ProjectRow): string {
  const content = row.broken ? `<span class="title-state tl-missing" title="${escapeHtml(row.broken)}">${icon("warning")}</span>` : formatLabel(row.format);
  return `<div class="col-engine">${content}</div>`;
}

function venueChip(row: ProjectRow, now: number): string {
  const venue = row.target?.venue;
  if (!venue) return "";
  const left = deadlineText(row.target, now);
  const tone = left && left.tone !== "normal" ? ` is-${left.tone}` : "";
  return `<span class="venue-chip${tone}">${escapeHtml(left ? `${venue} · ${left.text}` : venue)}</span>`;
}

function titleCell(row: ProjectRow, v: ProjectRowView): string {
  const outside = row.external ? `<span class="title-state ls-project-external" title="Outside the library">${icon("link")}</span>` : "";
  const tip = row.broken ?? row.title;
  return `<div class="col-title title-cell"><span class="title-text" title="${escapeHtml(tip)}">${highlight(row.title, v.terms)}</span>${outside}${venueChip(row, v.now)}</div>`;
}

function citesCell(row: ProjectRow): string {
  if (row.cites === undefined) return `<div class="col-cites"></div>`;
  const missing = row.unresolvedCites ?? 0;
  const tip = missing > 0 ? `${row.cites} cited, ${missing} not found` : `${row.cites} cited`;
  return `<div class="col-cites" title="${tip}">${row.cites}${missing > 0 ? ` <span class="cites-missing">${missing}</span>` : ""}</div>`;
}

const BUILT: Record<ProjectBuildState, string> = {
  ok: "Built", warnings: "Built, with warnings", failed: "Build failed", building: "Building", earlier: "Built in an earlier session", never: "Never built",
};

function buildTip(mark: BuildMark | undefined, now: number): string {
  const state = mark?.state ?? "never";
  const ago = mark?.at !== undefined && (state === "ok" || state === "warnings" || state === "failed") ? ` ${compactTime(mark.at, now)} ago` : "";
  return `${BUILT[state]}${ago}`;
}

function buildCell(row: ProjectRow, now: number): string {
  return `<div class="col-build" title="${buildTip(row.build, now)}"><span class="ls-build-dot b-${row.build?.state ?? "never"}"></span></div>`;
}

function timeCell(row: ProjectRow, v: ProjectRowView): string {
  const iso = shownTime(row, v.place);
  const full = iso ? new Date(iso).toLocaleString() : "";
  return `<div class="col-meta col-modified" title="${escapeHtml(full)}">${iso ? escapeHtml(compactTime(Date.parse(iso), v.now)) : ""}</div>`;
}

function rowHtml(row: ProjectRow, v: ProjectRowView): string {
  const expandable = row.broken ? "" : ` aria-expanded="false"`;
  return `<div class="paper-row-main${row.broken ? " is-broken" : ""}" role="row" aria-level="1" aria-selected="false" tabindex="-1"${expandable}>` +
    twistieCell(row) + titleCell(row, v) + engineCell(row) + citesCell(row) + buildCell(row, v.now) + timeCell(row, v) +
    `<div class="col-actions"><button class="ls-icon-btn" type="button" tabindex="-1" title="Project actions" aria-label="Project actions" data-act="menu">${icon("more")}</button></div>` +
    `</div>` +
    `<div class="paper-children" role="none"></div>`;
}

export function buildProjectRow(row: ProjectRow, v: ProjectRowView): HTMLElement {
  const inGroup = v.place === "projects" && !!row.folder;
  const node = el("div", { class: `paper-row${inGroup ? " in-group" : ""}`, role: "none", "data-id": row.id, html: rowHtml(row, v) });
  node.querySelectorAll('[role="row"] > div').forEach((cell) => cell.setAttribute("role", "gridcell"));
  return node;
}
