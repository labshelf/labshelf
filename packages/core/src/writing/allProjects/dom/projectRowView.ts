// Builds one project as a treegrid row: files twistie, format badge and title, open items, last modified (or trashed) time and the actions button.
import { relativeTime } from "../../../library/index.js";
import { formatLabel } from "../../../library-ui/dom/index.js";
import { el, highlight } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { ProjectPlace, ProjectRow } from "../projectRow.js";

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

function badge(row: ProjectRow): string {
  if (row.broken) return `<span class="title-state tl-missing" title="${escapeHtml(row.broken)}">${icon("warning")}</span>`;
  return formatLabel(row.format);
}

function titleCell(row: ProjectRow, terms: string[]): string {
  const outside = row.external ? `<span class="title-state ls-project-external" title="Outside the library">${icon("link")}</span>` : "";
  const tip = row.broken ?? row.title;
  return `<div class="col-title title-cell">${badge(row)}<span class="title-text" title="${escapeHtml(tip)}">${highlight(row.title, terms)}</span>${outside}</div>`;
}

function timeCell(row: ProjectRow, v: ProjectRowView): string {
  const iso = shownTime(row, v.place);
  const full = iso ? new Date(iso).toLocaleString() : "";
  return `<div class="col-meta col-modified" title="${escapeHtml(full)}">${escapeHtml(relativeTime(iso, v.now))}</div>`;
}

function rowHtml(row: ProjectRow, v: ProjectRowView): string {
  const open = row.openItems ? String(row.openItems) : "";
  const expandable = row.broken ? "" : ` aria-expanded="false"`;
  return `<div class="paper-row-main${row.broken ? " is-broken" : ""}" role="row" aria-level="1" aria-selected="false" tabindex="-1"${expandable}>` +
    twistieCell(row) + titleCell(row, v.terms) +
    `<div class="col-meta col-open">${open}</div>` + timeCell(row, v) +
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
