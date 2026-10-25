// Renders the project treegrid: sortable heads, then a windowed flat list of folder headers, projects and the expanded project's files.
import {
  drawSortableHeads,
  renderSortableHeadHtml,
  attachSortableHeads,
  formatLabel,
} from "../../../../libraryUi/dom/index.js";
import { type MenuAnchor, renderElement, renderHighlightedHtml } from "../../../../ui/dom/index.js";
import type { ProjectGroup, ProjectSortField, ProjectViewState } from "../../viewModel/index.js";
import type { ProjectPlace, BuildMark, ProjectBuildState, ProjectRow } from "../../projectRow.js";
import { createProjectTrayRows, type ProjectTrayFrame, type ProjectTrayHandlers } from "../tray/index.js";
import { createRowFocusKeeper } from "./projectListFocus.js";
import { attachProjectShortcuts } from "./projectListShortcuts.js";
import { createProjectKey, deriveProjectListRows, type ProjectListRow } from "./projectListModel.js";
import { createWindowedRows } from "./projectListWindow.js";
import { findAriaRow, updateRowMarks } from "./projectRowState.js";
import { escapeHtml, renderIcon } from "../../../../ui/index.js";
import { formatCompactTime } from "../../../../library/index.js";
import { formatDeadlineText } from "../../formatDeadlineText.js";

interface ProjectRowView {
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
  row.broken ? `<div></div>` : `<div class="expand-btn collapsed" title="Files">${renderIcon("chevron-down")}</div>`;

function engineCell(row: ProjectRow): string {
  const content = row.broken ? `<span class="title-state tl-missing" title="${escapeHtml(row.broken)}">${renderIcon("warning")}</span>` : formatLabel(row.format);
  return `<div class="col-engine">${content}</div>`;
}

function venueChip(row: ProjectRow, now: number): string {
  const venue = row.target?.venue;
  if (!venue) return "";
  const left = formatDeadlineText(row.target, now);
  const tone = left && left.tone !== "normal" ? ` is-${left.tone}` : "";
  return `<span class="venue-chip${tone}">${escapeHtml(left ? `${venue} · ${left.text}` : venue)}</span>`;
}

function titleCell(row: ProjectRow, v: ProjectRowView): string {
  const outside = row.external ? `<span class="title-state ls-project-external" title="Outside the library">${renderIcon("link")}</span>` : "";
  const tip = row.broken ?? row.title;
  return `<div class="col-title title-cell"><span class="title-text" title="${escapeHtml(tip)}">${renderHighlightedHtml(row.title, v.terms)}</span>${outside}${venueChip(row, v.now)}</div>`;
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
  const ago = mark?.at !== undefined && (state === "ok" || state === "warnings" || state === "failed") ? ` ${formatCompactTime(mark.at, now)} ago` : "";
  return `${BUILT[state]}${ago}`;
}

function buildCell(row: ProjectRow, now: number): string {
  return `<div class="col-build" title="${buildTip(row.build, now)}"><span class="ls-build-dot b-${row.build?.state ?? "never"}"></span></div>`;
}

function timeCell(row: ProjectRow, v: ProjectRowView): string {
  const iso = shownTime(row, v.place);
  const full = iso ? new Date(iso).toLocaleString() : "";
  return `<div class="col-meta col-modified" title="${escapeHtml(full)}">${iso ? escapeHtml(formatCompactTime(Date.parse(iso), v.now)) : ""}</div>`;
}

function rowHtml(row: ProjectRow, v: ProjectRowView): string {
  const expandable = row.broken ? "" : ` aria-expanded="false"`;
  return `<div class="paper-row-main${row.broken ? " is-broken" : ""}" role="row" aria-level="1" aria-selected="false" tabindex="-1"${expandable}>` +
    twistieCell(row) + titleCell(row, v) + engineCell(row) + citesCell(row) + buildCell(row, v.now) + timeCell(row, v) +
    `<div class="col-actions"><button class="ls-icon-btn" type="button" tabindex="-1" title="Project actions" aria-label="Project actions" data-act="menu">${renderIcon("more")}</button></div>` +
    `</div>`;
}

function buildProjectRow(row: ProjectRow, v: ProjectRowView): HTMLElement {
  const inGroup = v.place === "projects" && !!row.folder;
  const node = renderElement("div", { class: `paper-row${inGroup ? " in-group" : ""}`, role: "none", "data-id": row.id, html: rowHtml(row, v) });
  node.querySelectorAll('[role="row"] > div').forEach((cell) => cell.setAttribute("role", "gridcell"));
  return node;
}

/** The project row's cell count, which the header's single cell spans. */
const COLUMNS = 7;

const groupAriaLabel = (g: ProjectGroup): string =>
  `${g.segments.join(" / ")}, ${g.rows.length} ${g.rows.length === 1 ? "project" : "projects"}`;

function buildGroupRow(group: ProjectGroup, collapsed: boolean, onToggle: (key: string) => void): HTMLElement {
  const path = group.segments.map((s) => `<span class="group-segment">${escapeHtml(s)}</span>`).join(`<span class="group-sep" aria-hidden="true">/</span>`);
  const chevron = `<span class="group-chevron" aria-hidden="true">${renderIcon(collapsed ? "chevron-right" : "chevron-down")}</span>`;
  const node = renderElement("div", {
    class: "group-label", role: "row", tabindex: "-1", "aria-label": groupAriaLabel(group), title: group.segments.join(" / "),
    html: `<div class="group-cell" role="gridcell" aria-colspan="${COLUMNS}">${chevron}${path}</div>`,
  });
  node.addEventListener("click", () => onToggle(group.key));
  return node;
}

export interface ProjectListHandlers extends ProjectTrayHandlers {
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (id: string, anchor: MenuAnchor | HTMLElement) => void;
  onSort: (key: ProjectSortField) => void;
}

interface ProjectListFrame {
  view: ProjectViewState;
  groups: ProjectGroup[];
  selected: string | null;
  tray: ProjectTrayFrame;
  /** Shown after the rows; set only when there are none. */
  empty: HTMLElement | null;
}

export interface ProjectList {
  render(frame: ProjectListFrame): void;
  /** Focuses the selected row, else the list. */
  focus(): void;
  /** The flat rows of the last render, in display order. */
  rows(): readonly ProjectListRow[];
  /** Scrolls the row at `index` into view and returns its node, or null past the end. */
  reveal(index: number): HTMLElement | null;
  /** Collapses or expands a folder's projects; `folderKey` is the group's key. */
  toggleGroup(folderKey: string): void;
}

function headsHtml(place: ProjectPlace): string {
  const trash = place === "trash";
  return `<div aria-hidden="true"></div>` +
    renderSortableHeadHtml({ key: "title", label: "Title", cls: "", sortable: true }) +
    renderSortableHeadHtml({ key: "engine", label: "Engine", cls: "col-engine", sortable: false }) +
    renderSortableHeadHtml({ key: "cites", label: "Cites", cls: "col-cites", sortable: true, title: "Cited keys, then those not found" }) +
    renderSortableHeadHtml({ key: "build", label: "Build", cls: "col-build", sortable: false }) +
    renderSortableHeadHtml({ key: "modified", label: trash ? "Trashed" : "Modified", cls: "col-modified", sortable: true,
      ...(trash ? { title: "When the project went to the trash" } : {}) }) +
    `<div class="col-actions" aria-hidden="true"></div>`;
}

// Tray and header rows handle their own clicks, so only clicks on a project row reach these handlers.
function wireRows(el: HTMLElement, h: ProjectListHandlers): void {
  const rowId = (e: Event): string | undefined => (e.target as HTMLElement).closest<HTMLElement>(".paper-row")?.dataset["id"];
  el.addEventListener("click", (e) => {
    const id = rowId(e);
    if (!id) return;
    h.onSelect(id);
    if ((e.target as HTMLElement).closest(".expand-btn")) h.onToggle(id);
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-act="menu"]');
    if (button) h.onMenu(id, button);
  });
  el.addEventListener("dblclick", (e) => {
    const id = rowId(e);
    if (id && !(e.target as HTMLElement).closest('[data-act="menu"], .expand-btn')) h.onOpen(id);
  });
  el.addEventListener("contextmenu", (e) => {
    const id = rowId(e);
    if (!id) return;
    e.preventDefault();
    h.onSelect(id);
    h.onMenu(id, { x: e.clientX, y: e.clientY });
  });
}

type Item = ProjectListRow & { id: string };

function createRowWindow(el: HTMLElement, heads: HTMLElement, frame: () => ProjectListFrame, toggleGroup: (key: string) => void) {
  const terms = (): string[] => frame().view.query.split(/\s+/).filter(Boolean);
  return createWindowedRows<Item>(el, el.querySelector<HTMLElement>(".paper-rows")!, heads, {
    build: (item) => item.kind === "group" ? buildGroupRow(item.group, item.collapsed, toggleGroup)
      : item.kind === "file" ? item.tray.node : buildProjectRow(item.row, { place: frame().view.place, terms: terms(), now: Date.now() }),
    inputs: (item) => item.kind === "group" ? [item.group.key, item.group.rows.length, item.collapsed]
      : item.kind === "file" ? [item.tray.node] : [item.row, frame().view.place, frame().view.query],
    decorate: (item, node, index) => updateRowMarks(item, node, index, { selected: frame().selected, expanded: frame().tray.expanded }),
    focus: createRowFocusKeeper(el),
  });
}

// Collapsing the folder around the focused row would drop focus to the page, so focus moves to the folder's header.
// Returns that header's index, or -1 when focus is not inside the folder.
function headerHoldingFocus(el: HTMLElement, model: readonly ProjectListRow[], key: string, collapsed: ReadonlySet<string>): number {
  const focused = el.contains(document.activeElement) ? document.activeElement!.closest<HTMLElement>("[data-key]")?.dataset["key"] : undefined;
  const at = focused ? model.findIndex((r) => r.key === focused) : -1;
  const header = model.findIndex((r) => r.key === `g:${key}`);
  const holdsFocus = !collapsed.has(key) && header >= 0 && at > header && !model.slice(header + 1, at + 1).some((r) => r.kind === "group");
  return holdsFocus ? header : -1;
}

// A selected project inside a collapsed folder would be hidden, so its folder opens.
function openFolderOf(groups: readonly ProjectGroup[], id: string, collapsed: Set<string>): void {
  const group = groups.find((g) => g.segments.length > 0 && g.rows.some((r) => r.id === id));
  if (group) collapsed.delete(group.key);
}

function paintHeads(el: HTMLElement, heads: HTMLElement, view: ProjectViewState, headsPlace: ProjectPlace | null): void {
  if (headsPlace !== view.place) heads.innerHTML = headsHtml(view.place);
  drawSortableHeads(heads, view.sort.key, view.sort.dir === "asc");
  el.style.setProperty("--heads-h", `${heads.offsetHeight}px`);
}

export function mountProjectList(container: HTMLElement, h: ProjectListHandlers): ProjectList {
  container.innerHTML = `<div class="paper-list" tabindex="0" role="treegrid" aria-label="Projects">` +
    `<div class="col-heads" role="row" aria-rowindex="1"></div><div class="paper-rows" role="none"></div></div>`;
  const el = container.querySelector<HTMLElement>(".paper-list")!;
  const heads = el.querySelector<HTMLElement>(".col-heads")!;
  let frame: ProjectListFrame | null = null;
  let headsPlace: ProjectPlace | null = null, model: ProjectListRow[] = [];
  const collapsed = new Set<string>();
  const trayRows = createProjectTrayRows(h);
  const win = createRowWindow(el, heads, () => frame!, toggleGroup);
  const indexOf = (key: string): number => model.findIndex((r) => r.key === key);
  const paint = (next: ProjectListFrame): void => {
    model = deriveProjectListRows({ groups: next.groups, collapsed, expanded: next.tray.expanded, trayRows: (row) => trayRows(row, next.tray) });
    el.setAttribute("aria-rowcount", String(model.length + 1));
    win.update(model.map((r) => ({ ...r, id: r.key })), next.empty);
    el.tabIndex = el.querySelector(".paper-row.selected") ? -1 : 0;
  };
  function toggleGroup(key: string): void {
    const header = headerHoldingFocus(el, model, key, collapsed);
    if (!collapsed.delete(key)) collapsed.add(key);
    if (!frame) return;
    paint(frame);
    if (header >= 0) { const node = win.reveal(header); if (node) findAriaRow(node).focus(); }
  }
  attachSortableHeads(heads, (key) => h.onSort(key as ProjectSortField));
  wireRows(el, h);
  const api: ProjectList = {
    render(next) {
      const placeChanged = frame?.view.place !== next.view.place;
      const selectionChanged = frame?.selected !== next.selected;
      frame = next;
      if (selectionChanged && next.selected) openFolderOf(next.groups, next.selected, collapsed);
      paintHeads(el, heads, next.view, headsPlace);
      headsPlace = next.view.place;
      if (placeChanged) el.scrollTop = 0;
      paint(next);
      if (selectionChanged && next.selected) api.reveal(indexOf(createProjectKey(next.selected)));
    },
    focus() {
      const at = frame?.selected ? indexOf(createProjectKey(frame.selected)) : -1;
      (api.reveal(at)?.querySelector<HTMLElement>(".paper-row-main") ?? el).focus();
    },
    rows: () => model,
    reveal: (index) => win.reveal(index),
    toggleGroup,
  };
  const pageSize = (): number => Math.max(1, (win.viewportRows() ?? el.querySelectorAll(".paper-rows > [data-key]").length) - 1);
  attachProjectShortcuts(el, h, { rows: api.rows, reveal: api.reveal, toggleGroup, pageSize, selected: () => frame?.selected ?? null });
  return api;
}
