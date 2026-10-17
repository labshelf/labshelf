// Renders the project treegrid: sortable heads and the rows grouped by folder, kept in step by id, with selection and the expanded project's files.
import { GroupedRows, RowReconciler, paintSortableHeads, sortableHeadHtml, wireSortableHeads } from "../../../library-ui/dom/index.js";
import type { MenuAnchor } from "../../../ui/dom/index.js";
import type { ProjectGroup, ProjectSortKey, ProjectViewState } from "../derive/index.js";
import type { ProjectPlace, ProjectRow } from "../projectRow.js";
import { wireProjectKeys } from "./projectListKeys.js";
import { buildProjectRow } from "./projectRowView.js";
import { paintProjectTray, type ProjectTrayFrame, type ProjectTrayHandlers } from "./tray/index.js";

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
}

const groupAriaLabel = (g: ProjectGroup): string => `${g.segments.join(" › ")}, ${g.rows.length} ${g.rows.length === 1 ? "project" : "projects"}`;

function headsHtml(place: ProjectPlace): string {
  const trash = place === "trash";
  return `<div aria-hidden="true"></div>` +
    sortableHeadHtml({ key: "title", label: "Title", cls: "", sortable: true }) +
    sortableHeadHtml({ key: "openItems", label: "Open items", cls: "col-open", title: "Open comments and review items", sortable: true }) +
    sortableHeadHtml({ key: "modified", label: trash ? "Trashed" : "Last modified", cls: "col-modified", sortable: true,
      ...(trash ? { title: "When the project went to the trash" } : {}) }) +
    `<div class="col-actions" aria-hidden="true"></div>`;
}

// Tray rows handle their own clicks, so only clicks on a project row reach these handlers.
function wireRows(el: HTMLElement, h: ProjectListHandlers): void {
  const rowId = (e: Event): string | undefined => {
    const target = e.target as HTMLElement;
    return target.closest(".paper-children") ? undefined : target.closest<HTMLElement>(".paper-row")?.dataset["id"];
  };
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

function paintSelection(el: HTMLElement, selected: string | null): void {
  el.querySelectorAll<HTMLElement>(".paper-row").forEach((r) => {
    const on = r.dataset["id"] === selected;
    r.classList.toggle("selected", on);
    const main = r.querySelector<HTMLElement>(".paper-row-main");
    main?.setAttribute("aria-selected", String(on));
    main?.setAttribute("tabindex", on ? "0" : "-1");
  });
  el.tabIndex = el.querySelector(".paper-row.selected") ? -1 : 0;
}

/** Marks the expanded project's row and every other collapsed, without rebuilding rows, so focus and scroll stay. */
function paintExpanded(el: HTMLElement, expanded: string | null): void {
  el.querySelectorAll<HTMLElement>(".paper-row").forEach((r) => {
    const twistie = r.querySelector(".expand-btn");
    if (!twistie) return;
    const on = r.dataset["id"] === expanded;
    r.classList.toggle("expanded", on);
    twistie.classList.toggle("collapsed", !on);
    r.querySelector(".paper-row-main")?.setAttribute("aria-expanded", String(on));
  });
}

export function mountProjectList(container: HTMLElement, h: ProjectListHandlers): ProjectList {
  // INVARIANT: each reconciler removes every child of its container it did not build, so the groups and each group body get their own.
  container.innerHTML = `<div class="paper-list" tabindex="0" role="treegrid" aria-label="Projects">` +
    `<div class="col-heads" role="row"></div><div class="paper-rows" role="none"></div></div>`;
  const el = container.querySelector<HTMLElement>(".paper-list")!;
  const heads = el.querySelector<HTMLElement>(".col-heads")!;
  let frame: ProjectListFrame | null = null;
  let headsPlace: ProjectPlace | null = null;
  const terms = (): string[] => (frame?.view.query ?? "").split(/\s+/).filter(Boolean);
  const rows = new GroupedRows<ProjectRow, ProjectGroup>(el.querySelector<HTMLElement>(".paper-rows")!,
    (body) => new RowReconciler<ProjectRow>(body, (row) => buildProjectRow(row, { place: frame!.view.place, terms: terms(), now: Date.now() }),
      (row) => [row, frame!.view.place, frame!.view.query]),
    { items: (g) => g.rows, ariaLabel: groupAriaLabel });
  wireSortableHeads(heads, (key) => h.onSort(key as ProjectSortKey));
  wireRows(el, h);
  wireProjectKeys(el, h, () => frame?.selected ?? null);
  const paintHeadsHeight = (): void => el.style.setProperty("--heads-h", `${heads.offsetHeight}px`);
  // ResizeObserver is absent where the list renders without layout (jsdom).
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(paintHeadsHeight).observe(heads);
  return {
    render(next) {
      const placeChanged = frame?.view.place !== next.view.place;
      frame = next;
      if (headsPlace !== next.view.place) { heads.innerHTML = headsHtml(next.view.place); headsPlace = next.view.place; }
      paintSortableHeads(heads, next.view.sort.key, next.view.sort.dir === "asc");
      rows.update(next.groups, next.empty);
      paintSelection(el, next.selected);
      paintExpanded(el, next.tray.expanded);
      paintProjectTray(el, new Map(next.groups.flatMap((g) => g.rows.map((r) => [r.id, r]))), next.tray, h);
      paintHeadsHeight();
      if (placeChanged) el.scrollTop = 0;
      el.querySelector(".paper-row.selected")?.scrollIntoView?.({ block: "nearest" });
    },
    focus() {
      (el.querySelector<HTMLElement>(".paper-row.selected .paper-row-main") ?? el).focus();
    },
  };
}
