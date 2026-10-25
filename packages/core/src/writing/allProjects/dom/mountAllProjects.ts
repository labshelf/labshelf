/**
 * Mounts the All projects page: place tabs, search, and the project list, talking to its host only through the transport.
 * Host stylesheets: tokens.css, vscodeHost.css (VS Code), base.css, toast.css, library-ui.css, library-list.css, library-sidebar.css, library-detail.css, library-tabs.css, all-projects.css.
 */
import { buildFrame } from "../../../libraryUi/dom/index.js";
import type { ShareHost } from "../../../libraryUi/share/index.js";
import type { PanePrefsPort } from "../../../libraryUi/store/index.js";
import { showMenu, toast, type MenuAnchor, el } from "../../../ui/dom/index.js";
import { DEFAULT_PROJECT_VIEW, deriveProjectView, firstProjectSortDir, placeCounts, type ProjectSortKey, type ProjectViewState } from "../viewModel/index.js";
import type { AllProjectsToHost, AllProjectsTransport, HostToAllProjects } from "../protocol/index.js";
import type { NewProjectKind, ProjectMenuCommand, ProjectPlace, ProjectRow } from "../projectRow.js";
import { mountAllProjectsHeader } from "./allProjectsHeader.js";
import { emptyTrash } from "./projectActions.js";
import { mountProjectList, type ProjectListHandlers } from "./list/index.js";
import { projectMenuEntries } from "./projectMenu.js";
import { createDetailRequests } from "./detailPane/index.js";
import { createProjectExpansion, type ProjectExpansion } from "./tray/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";

interface EmptyStateOptions {
  place: ProjectPlace;
  query: string;
  onClearQuery: () => void;
  onNew: (anchor: HTMLElement) => void;
}

const EMPTY_TEXT: Record<ProjectPlace, string> = { projects: "No projects yet", archived: "No archived projects", trash: "Trash is empty" };

function buildProjectEmptyState(o: EmptyStateOptions): HTMLElement {
  const box = el("div", { class: "ls-empty" });
  if (o.query.trim()) {
    box.innerHTML = `<div class="ls-empty-icon">${icon("search")}</div><div class="ls-empty-text">No projects match “${escapeHtml(o.query.trim())}”</div>` +
      `<button class="ls-btn" type="button">Clear search</button>`;
    box.querySelector("button")!.addEventListener("click", o.onClearQuery);
    return box;
  }
  box.innerHTML = `<div class="ls-empty-icon">${icon(o.place === "trash" ? "trash" : "file-text")}</div><div class="ls-empty-text">${EMPTY_TEXT[o.place]}</div>`;
  if (o.place === "projects") {
    const button = el("button", { class: "ls-btn ls-btn-primary", type: "button", html: `${icon("plus")}<span>New project</span>` });
    button.addEventListener("click", () => o.onNew(button));
    box.append(button);
  }
  return box;
}

interface PageState {
  view: ProjectViewState;
  rows: ProjectRow[];
  commands: ProjectMenuCommand[];
  newKinds: NewProjectKind[];
  selected: string | null;
}

export interface AllProjectsChannel {
  transport: AllProjectsTransport;
  prefs: PanePrefsPort;
  /** The host's sharing operations; the project menu offers sharing only when present. */
  sharing?: ShareHost | undefined;
}

const NEW_ENTRIES: ReadonlyArray<{ kind: NewProjectKind; label: string; icon: "file" | "layers" | "folder-open" }> = [
  { kind: "blank", label: "Blank project", icon: "file" },
  { kind: "template", label: "From template…", icon: "layers" },
  { kind: "folder", label: "Add existing folder…", icon: "folder-open" },
];

function showNewMenu(anchor: HTMLElement, post: AllProjectsTransport["post"], kinds: readonly NewProjectKind[]): void {
  showMenu(anchor, NEW_ENTRIES.filter((e) => kinds.includes(e.kind)).map((e) => ({
    label: e.label, icon: e.icon, onSelect: () => post({ type: "create", kind: e.kind }),
  })));
}

type HostMessage<T extends HostToAllProjects["type"]> = Extract<HostToAllProjects, { type: T }>;

function routeMessages(transport: AllProjectsTransport, on: {
  files: (m: HostMessage<"files">) => void;
  detail: (m: HostMessage<"detail">) => void;
  projects: (m: HostMessage<"projects">) => void;
}): void {
  transport.subscribe((message) => {
    if (message.type === "error") toast(message.message, "error");
    else if (message.type === "files") on.files(message);
    else if (message.type === "detail") on.detail(message);
    else on.projects(message);
  });
}

const toggledSort = (sort: ProjectViewState["sort"], key: ProjectSortKey): ProjectViewState["sort"] =>
  sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: firstProjectSortDir(key) };

interface RowHandlerDeps {
  s: PageState;
  post: AllProjectsTransport["post"];
  rowById: (id: string) => ProjectRow | undefined;
  select: (id: string) => void;
  set: (view: Partial<ProjectViewState>) => void;
  sharing: ShareHost | undefined;
}

function rowHandlers(d: RowHandlerDeps, tray: ProjectExpansion["handlers"]): ProjectListHandlers {
  const { s, post, rowById } = d;
  return {
    ...tray,
    onSelect: d.select,
    onOpen: (id) => { const row = rowById(id); if (row && row.place !== "trash" && !row.broken) post({ type: "open", id }); },
    onMenu: (id, anchor: MenuAnchor | HTMLElement) => {
      const row = rowById(id);
      if (row) showMenu(anchor, projectMenuEntries(row, { rows: s.rows, commands: s.commands, post, sharing: d.sharing }));
    },
    onSort: (key: ProjectSortKey) => d.set({ sort: toggledSort(s.view.sort, key) }),
  };
}

export function mountAllProjects(root: HTMLElement, { transport, prefs, sharing }: AllProjectsChannel): void {
  const s: PageState = { view: DEFAULT_PROJECT_VIEW, rows: [], commands: [], newKinds: ["blank", "template", "folder"], selected: null };
  const post = transport.post.bind(transport);
  const frame = buildFrame(root, prefs, { withSidebar: false, withCitationMap: false });
  frame.root.classList.add("ls-all-projects");
  const set = (view: Partial<ProjectViewState>): void => { s.view = { ...s.view, ...view }; render(); };
  const rowById = (id: string): ProjectRow | undefined => s.rows.find((r) => r.id === id);
  const onNew = (anchor: HTMLElement): void => showNewMenu(anchor, post, s.newKinds);
  const details = createDetailRequests(post);
  const select = (id: string): void => { if (id !== s.selected) details.request(id); s.selected = id; render(); };
  const expansion = createProjectExpansion({ post, rowById, select, detailOf: details.get, render });
  details.onChange((id) => { if (id === s.selected || id === expansion.frame().expanded) render(); });
  const header = mountAllProjectsHeader(frame.header, {
    onPlace: (place: ProjectPlace) => { if (place !== s.view.place) { s.selected = null; set({ place }); } },
    onQuery: (query) => set({ query }),
    onNew,
    onEmptyTrash: () => void emptyTrash(placeCounts(s.rows).trash, post),
    onLeaveSearch: () => list.focus(),
  });
  const list = mountProjectList(frame.list, rowHandlers({ s, post, rowById, select, set, sharing }, expansion.handlers));
  const selection = reportSelection(post);

  function render(): void {
    const groups = deriveProjectView(s.rows, s.view);
    const shown = new Set(groups.flatMap((g) => g.rows.map((r) => r.id)));
    if (s.selected && !shown.has(s.selected)) s.selected = null;
    expansion.keepShown(shown);
    header.paint(s.view.place, placeCounts(s.rows), s.view.query);
    const empty = shown.size > 0 ? null : buildProjectEmptyState({ place: s.view.place, query: s.view.query, onClearQuery: () => set({ query: "" }), onNew });
    list.render({ view: s.view, groups, selected: s.selected, tray: expansion.frame(), empty });
    selection.update(s.selected);
  }

  routeMessages(transport, {
    files: expansion.receive,
    detail: details.receive,
    projects: (message) => {
      s.rows = message.rows; s.commands = message.commands; s.newKinds = message.newKinds;
      render();
      if (s.selected) details.request(s.selected);
    },
  });
  render();
  post({ type: "ready" });
  selection.start(s.selected);
}

/** Posts `project.selected` once per change, from the selection current when `start` runs after `ready`. */
function reportSelection(post: (m: AllProjectsToHost) => void): { start(id: string | null): void; update(id: string | null): void } {
  // INVARIANT: undefined until `start`, so the host never hears a selection before the page's `ready`.
  let reported: string | null | undefined;
  const send = (id: string | null): void => { reported = id; post({ type: "project.selected", id }); };
  return { start: send, update: (id) => { if (reported !== undefined && id !== reported) send(id); } };
}
