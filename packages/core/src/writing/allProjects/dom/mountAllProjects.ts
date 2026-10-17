/**
 * Mounts the All projects page: place tabs, search and the project list, talking to its host only through the transport.
 * Host stylesheets: tokens.css, vscodeHost.css (VS Code), base.css, toast.css, library-ui.css, library-list.css, library-sidebar.css, all-projects.css.
 */
import { el, showMenu, toast, type MenuAnchor } from "../../../ui/dom/index.js";
import { DEFAULT_PROJECT_VIEW, deriveProjectView, firstProjectSortDir, placeCounts, type ProjectSortKey, type ProjectViewState } from "../derive/index.js";
import type { AllProjectsTransport } from "../protocol/index.js";
import type { ProjectMenuCommand, ProjectPlace, ProjectRow } from "../projectRow.js";
import { mountAllProjectsHeader } from "./allProjectsHeader.js";
import { emptyTrash } from "./projectActions.js";
import { buildProjectEmptyState } from "./projectEmptyState.js";
import { mountProjectList } from "./projectList.js";
import { projectMenuEntries } from "./projectMenu.js";
import { createProjectExpansion } from "./tray/index.js";

interface PageState {
  view: ProjectViewState;
  rows: ProjectRow[];
  commands: ProjectMenuCommand[];
  selected: string | null;
}

function buildLayout(root: HTMLElement): { header: HTMLElement; body: HTMLElement } {
  const header = el("div", { class: "list-header" });
  const body = el("div", { class: "list-body" });
  root.replaceChildren(el("div", { class: "ls-library ls-all-projects" }, el("div", { class: "list-pane" }, header, body)));
  return { header, body };
}

function showNewMenu(anchor: HTMLElement, post: AllProjectsTransport["post"]): void {
  showMenu(anchor, [
    { label: "Blank project", icon: "file", onSelect: () => post({ type: "create", kind: "blank" }) },
    { label: "From template…", icon: "layers", onSelect: () => post({ type: "create", kind: "template" }) },
    { label: "Add existing folder…", icon: "folder-open", onSelect: () => post({ type: "create", kind: "folder" }) },
  ]);
}

export function mountAllProjects(root: HTMLElement, transport: AllProjectsTransport): void {
  const s: PageState = { view: DEFAULT_PROJECT_VIEW, rows: [], commands: [], selected: null };
  const post = transport.post.bind(transport);
  const layout = buildLayout(root);
  const set = (view: Partial<ProjectViewState>): void => { s.view = { ...s.view, ...view }; render(); };
  const rowById = (id: string): ProjectRow | undefined => s.rows.find((r) => r.id === id);
  const onNew = (anchor: HTMLElement): void => showNewMenu(anchor, post);
  const select = (id: string): void => { s.selected = id; render(); };
  const expansion = createProjectExpansion({ post, rowById, select, render });
  const header = mountAllProjectsHeader(layout.header, {
    onPlace: (place: ProjectPlace) => { if (place !== s.view.place) { s.selected = null; set({ place }); } },
    onQuery: (query) => set({ query }),
    onNew,
    onEmptyTrash: () => void emptyTrash(placeCounts(s.rows).trash, post),
    onLeaveSearch: () => list.focus(),
  });
  const list = mountProjectList(layout.body, {
    ...expansion.handlers,
    onSelect: select,
    onOpen: (id) => { const row = rowById(id); if (row && row.place !== "trash" && !row.broken) post({ type: "open", id }); },
    onMenu: (id, anchor: MenuAnchor | HTMLElement) => {
      const row = rowById(id);
      if (row) showMenu(anchor, projectMenuEntries(row, { rows: s.rows, commands: s.commands, post }));
    },
    onSort: (key: ProjectSortKey) => set({ sort: s.view.sort.key === key
      ? { key, dir: s.view.sort.dir === "asc" ? "desc" : "asc" }
      : { key, dir: firstProjectSortDir(key) } }),
  });

  function render(): void {
    const groups = deriveProjectView(s.rows, s.view);
    const shown = new Set(groups.flatMap((g) => g.rows.map((r) => r.id)));
    if (s.selected && !shown.has(s.selected)) s.selected = null;
    expansion.keepShown(shown);
    header.paint(s.view.place, placeCounts(s.rows), s.view.query);
    const empty = shown.size > 0 ? null : buildProjectEmptyState({ place: s.view.place, query: s.view.query, onClearQuery: () => set({ query: "" }), onNew });
    list.render({ view: s.view, groups, selected: s.selected, tray: expansion.frame(), empty });
  }

  transport.subscribe((message) => {
    if (message.type === "error") { toast(message.message, "error"); return; }
    if (message.type === "files") { expansion.receive(message); return; }
    s.rows = message.rows;
    s.commands = message.commands;
    render();
  });
  render();
  post({ type: "ready" });
}
