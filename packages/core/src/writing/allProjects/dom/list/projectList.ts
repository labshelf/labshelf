// Renders the project treegrid: sortable heads, then a windowed flat list of folder headers, projects and the expanded project's files.
import { paintSortableHeads, sortableHeadHtml, wireSortableHeads } from "../../../../libraryUi/dom/index.js";
import type { MenuAnchor } from "../../../../ui/dom/index.js";
import type { ProjectGroup, ProjectSortKey, ProjectViewState } from "../../viewModel/index.js";
import type { ProjectPlace } from "../../projectRow.js";
import { createProjectTrayRows, type ProjectTrayFrame, type ProjectTrayHandlers } from "../tray/index.js";
import { buildGroupRow } from "./groupRowView.js";
import { keepRowFocus } from "./projectListFocus.js";
import { wireProjectKeys } from "./projectListShortcuts.js";
import { projectKey, projectListRows, type ProjectListRow } from "./projectListModel.js";
import { createWindowedRows } from "./projectListWindow.js";
import { ariaRowOf, paintRowState } from "./projectRowState.js";
import { buildProjectRow } from "./projectRowView.js";

export interface ProjectListHandlers extends ProjectTrayHandlers {
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (id: string, anchor: MenuAnchor | HTMLElement) => void;
  onSort: (key: ProjectSortKey) => void;
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
    sortableHeadHtml({ key: "title", label: "Title", cls: "", sortable: true }) +
    sortableHeadHtml({ key: "engine", label: "Engine", cls: "col-engine", sortable: false }) +
    sortableHeadHtml({ key: "cites", label: "Cites", cls: "col-cites", sortable: true, title: "Cited keys, then those not found" }) +
    sortableHeadHtml({ key: "build", label: "Build", cls: "col-build", sortable: false }) +
    sortableHeadHtml({ key: "modified", label: trash ? "Trashed" : "Modified", cls: "col-modified", sortable: true,
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
    decorate: (item, node, index) => paintRowState(item, node, index, { selected: frame().selected, expanded: frame().tray.expanded }),
    focus: keepRowFocus(el),
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
  paintSortableHeads(heads, view.sort.key, view.sort.dir === "asc");
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
    model = projectListRows({ groups: next.groups, collapsed, expanded: next.tray.expanded, trayRows: (row) => trayRows(row, next.tray) });
    el.setAttribute("aria-rowcount", String(model.length + 1));
    win.update(model.map((r) => ({ ...r, id: r.key })), next.empty);
    el.tabIndex = el.querySelector(".paper-row.selected") ? -1 : 0;
  };
  function toggleGroup(key: string): void {
    const header = headerHoldingFocus(el, model, key, collapsed);
    if (!collapsed.delete(key)) collapsed.add(key);
    if (!frame) return;
    paint(frame);
    if (header >= 0) { const node = win.reveal(header); if (node) ariaRowOf(node).focus(); }
  }
  wireSortableHeads(heads, (key) => h.onSort(key as ProjectSortKey));
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
      if (selectionChanged && next.selected) api.reveal(indexOf(projectKey(next.selected)));
    },
    focus() {
      const at = frame?.selected ? indexOf(projectKey(frame.selected)) : -1;
      (api.reveal(at)?.querySelector<HTMLElement>(".paper-row-main") ?? el).focus();
    },
    rows: () => model,
    reveal: (index) => win.reveal(index),
    toggleGroup,
  };
  const pageSize = (): number => Math.max(1, (win.viewportRows() ?? el.querySelectorAll(".paper-rows > [data-key]").length) - 1);
  wireProjectKeys(el, h, { rows: api.rows, reveal: api.reveal, toggleGroup, pageSize, selected: () => frame?.selected ?? null });
  return api;
}
