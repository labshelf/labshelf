// Builds the Projects section body: project rows grouped under sub-headings, or an empty state with three actions.
import type { ArcProgress, ArcTone } from "../../../ui/index.js";
import { el } from "../../../ui/dom/index.js";
import { icon } from "../../../ui/index.js";
import { headingRow, projectRow } from "./sidebarRows.js";

/** A writing project as the sidebar lists it; `id` is the host's opaque key (a folder path). */
export interface SidebarProject {
  id: string;
  name: string;
  /** Sub-heading the project sits under; headings show only when projects span more than one group. */
  group: string;
  mark: { tone: ArcTone; progress: ArcProgress };
  /** Right-aligned text, like a folder's count. */
  count?: string;
  /** Multi-line `title` attribute. */
  tooltip: string;
}

/** What the Projects section asks the host to do. */
export interface SidebarProjectActions {
  open(id: string): void;
  /** The host shows its own menu at the pointer. */
  menu(id: string, at: { x: number; y: number }): void;
  browseTemplates(): void;
  newBlank(): void;
  addExisting(): void;
}

export const PROJECT_HEADER_ACTIONS =
  `<button class="ls-icon-btn" data-tree="browse" title="Browse templates">${icon("plus")}</button>` +
  `<button class="ls-icon-btn" data-tree="add" title="Add existing folder">${icon("folder-open")}</button>`;

const emptyButton = (action: string, label: string, glyph: "plus" | "folder-plus" | "folder-open"): string =>
  `<button class="ls-btn" data-tree="${action}" tabindex="-1">${icon(glyph)}${label}</button>`;

function emptyState(): HTMLElement {
  return el("div", { class: "tree-empty", html: "No projects yet." +
    `<div class="tree-empty-actions">${emptyButton("browse", "Browse templates", "plus")}${emptyButton("blank", "New blank project", "folder-plus")}${emptyButton("add", "Add existing folder", "folder-open")}</div>` });
}

/** The section's rows in order; group sub-headings appear only when projects span more than one group. */
export function projectNodes(projects: readonly SidebarProject[]): HTMLElement[] {
  if (projects.length === 0) return [emptyState()];
  const groups = [...new Set(projects.map((p) => p.group))];
  if (groups.length < 2) return projects.map(projectRow);
  return groups.flatMap((group) => [headingRow(group), ...projects.filter((p) => p.group === group).map(projectRow)]);
}
