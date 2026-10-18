// Builds the Writing tab's markup: ready and broken project rows, their reading lists, and the empty, loading and failed states.
import { STATUS_LABEL } from "../../../model/index.js";
import { escapeHtml, icon, statusMark } from "../../../ui/index.js";
import type { ProjectFormat, ProjectLocation } from "../../../writing/project/index.js";
import type { ReadingListEntry } from "../../../writing/readingList/index.js";
import type { WritingTabProject } from "./writingTabHost.js";

type ReadyProject = Extract<WritingTabProject, { kind: "ready" }>;
type BrokenProject = Extract<WritingTabProject, { kind: "broken" }>;

const FORMAT_LABEL: Record<ProjectFormat, string> = { latex: "LaTeX", typst: "Typst" };
const LOCATION_LABEL: Record<ProjectLocation, string> = { library: "Library", external: "External folder" };

function note(text: string, extra = ""): string {
  return `<div class="wt-note${extra}">${escapeHtml(text)}</div>`;
}

export function loadingHtml(): string {
  return `<div class="wt-note"><span class="wt-spin">${icon("loader")}</span>Loading writing projects…</div>`;
}

export function emptyHtml(): string {
  return `<div class="wt-empty">${icon("file-text")}<div class="wt-empty-title">No writing projects yet</div>` +
    note("Projects you create in the library or register from a folder appear here.") + `</div>`;
}

export function failedHtml(message: string): string {
  return `<div class="wt-failed" role="alert">${icon("warning")}<div class="wt-failed-body">` +
    `<div class="wt-failed-title">Could not list writing projects</div>${note(message)}` +
    `<button class="ls-btn" type="button" data-action="retry">Try again</button></div></div>`;
}

function entryHtml(entry: ReadingListEntry): string {
  const paper = entry.paper;
  if (!paper) {
    return `<li class="wt-paper missing" title="No library paper has this citation key">` +
      `<span class="wt-paper-mark"></span><span class="wt-paper-key">${escapeHtml(entry.key)}</span></li>`;
  }
  const status = STATUS_LABEL[paper.status];
  return `<li><button class="wt-paper" type="button" data-action="openPaper" data-paper="${escapeHtml(paper.id)}" title="Open ${escapeHtml(paper.title)}">` +
    `<span class="wt-paper-mark s-${paper.status}" role="img" aria-label="${status}" title="${status}">${statusMark(paper.status)}</span>` +
    `<span class="wt-paper-title">${escapeHtml(paper.title)}</span></button></li>`;
}

function readingListHtml(listId: string, project: ReadyProject, open: boolean): string {
  const body = project.readingList.length
    ? `<ul class="wt-papers">${project.readingList.map(entryHtml).join("")}</ul>`
    : note("No papers cited or added yet.");
  return `<div class="wt-reading" id="${listId}"${open ? "" : " hidden"}>${body}</div>`;
}

function pdfActionHtml(project: ReadyProject): string {
  if (project.pdf === undefined) { return `<span class="wt-no-pdf">No PDF yet</span>`; }
  return `<button class="ls-btn" type="button" data-action="openPdf" data-project="${escapeHtml(project.id)}" data-pdf="${escapeHtml(project.pdf)}" ` +
    `title="Open ${escapeHtml(project.pdf)} in the reader">${icon("book-open")}Open PDF</button>`;
}

/** One ready project; `index` keeps the reading list's DOM id unique even if two ids escape to the same text. */
export function readyProjectHtml(project: ReadyProject, index: number, open: boolean): string {
  const listId = `wt-reading-${index}`;
  const count = project.readingList.length;
  return `<li class="wt-project" data-project-id="${escapeHtml(project.id)}">` +
    `<div class="wt-head">` +
      `<button class="wt-toggle" type="button" data-action="toggle" aria-expanded="${open}" aria-controls="${listId}" ` +
        `title="${open ? "Hide" : "Show"} the reading list">` +
        `<span class="wt-chevron">${icon("chevron-down")}</span>` +
        `<span class="wt-format ${project.format}">${FORMAT_LABEL[project.format]}</span>` +
        `<span class="wt-name">${escapeHtml(project.name)}</span>` +
        `<span class="wt-count" aria-label="${count} papers">${count}</span>` +
      `</button>` +
      `<span class="wt-location">${LOCATION_LABEL[project.location]}</span>` +
      `<span class="wt-actions">${pdfActionHtml(project)}` +
        `<button class="ls-btn ls-btn-ghost" type="button" disabled title="Editing in the browser is not available yet">${icon("edit")}Edit</button>` +
      `</span>` +
    `</div>` + readingListHtml(listId, project, open) + `</li>`;
}

export function brokenProjectHtml(project: BrokenProject): string {
  return `<li class="wt-project broken">` +
    `<div class="wt-head"><span class="wt-broken-icon">${icon("warning")}</span>` +
      `<span class="wt-name" title="${escapeHtml(project.folder)}">${escapeHtml(project.folder)}</span>` +
      `<span class="wt-location">${LOCATION_LABEL[project.location]}</span></div>` +
    note(project.reason, " wt-reason") + `</li>`;
}
