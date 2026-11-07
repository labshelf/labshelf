/**
 * Mounts the All projects page: place tabs, search, and the project list, talking to its host only through the transport.
 * Host stylesheets: tokens.css, codeThemes.css, vscodeHost.css (VS Code), base.css, toast.css, library-ui.css, library-list.css, library-sidebar.css, library-detail.css, library-tabs.css, all-projects.css.
 */
import { buildFrame } from "../../../libraryUi/dom/index.js";
import type { ShareHost } from "../../../share/index.js";
import type { PanePrefsPort } from "../../../libraryUi/store/index.js";
import { showMenu, showToast, type MenuAnchor, renderElement, mountPlaceHeader, type PlaceHeader, type PlaceHeaderHandlers } from "../../../ui/dom/index.js";
import {
  DEFAULT_PROJECT_VIEW, deriveProjectView, deriveFirstProjectSortDir, countPlaces,
  type CreateProjectKind, type ProjectMenuCommand, type ProjectPlace, type ProjectRow, type ProjectSortField, type ProjectViewState,
} from "../projectModel.js";
import type { AllProjectsToHost, AllProjectsTransport, HostToAllProjects } from "../protocol.js";
import { removeAllTrash, createProjectMenuEntries } from "./projectActions.js";
import { mountProjectList, type ProjectListHandlers } from "./projectList.js";
import { createPaneRequests } from "./projectDetailPane.js";
import { createProjectExpansion, type ProjectExpansion } from "./projectTray.js";
import { runShareProjectDialog } from "../../../collab/dom/index.js";
import { mountInvitations } from "./invitations.js";
import { escapeHtml, renderIcon } from "../../../ui/index.js";

const PLACES: { id: ProjectPlace; label: string }[] = [
  { id: "projects", label: "All projects" }, { id: "archived", label: "Archived" }, { id: "trash", label: "Trash" },
];

export type HeaderHandlers = PlaceHeaderHandlers<ProjectPlace>;
export type AllProjectsHeader = PlaceHeader<ProjectPlace>;

export function mountAllProjectsHeader(container: HTMLElement, h: HeaderHandlers): AllProjectsHeader {
  return mountPlaceHeader<ProjectPlace>(container, {
    places: PLACES, ariaLabel: "Project places", placeholder: "Search projects", inputClass: "ls-all-projects-search",
    newLabel: "New project", newTitle: "New project", emptyTrashTitle: "Delete every project in the trash", withShare: true,
  }, h);
}

interface EmptyStateOptions {
  place: ProjectPlace;
  query: string;
  onClearQuery: () => void;
  onNew: (anchor: HTMLElement) => void;
}

const EMPTY_TEXT: Record<ProjectPlace, string> = { projects: "No projects yet", archived: "No archived projects", trash: "Trash is empty" };

function buildProjectEmptyState(o: EmptyStateOptions): HTMLElement {
  const box = renderElement("div", { class: "ls-empty" });
  if (o.query.trim()) {
    box.innerHTML = `<div class="ls-empty-icon">${renderIcon("search")}</div><div class="ls-empty-text">No projects match “${escapeHtml(o.query.trim())}”</div>` +
      `<button class="ls-btn" type="button">Clear search</button>`;
    box.querySelector("button")!.addEventListener("click", o.onClearQuery);
    return box;
  }
  box.innerHTML = `<div class="ls-empty-icon">${renderIcon(o.place === "trash" ? "trash" : "file-text")}</div><div class="ls-empty-text">${EMPTY_TEXT[o.place]}</div>`;
  if (o.place === "projects") {
    const button = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button", html: `${renderIcon("plus")}<span>New project</span>` });
    button.addEventListener("click", () => o.onNew(button));
    box.append(button);
  }
  return box;
}

interface PageState {
  view: ProjectViewState;
  rows: ProjectRow[];
  commands: ProjectMenuCommand[];
  newKinds: CreateProjectKind[];
  selected: string | null;
}

export interface AllProjectsChannel {
  transport: AllProjectsTransport;
  prefs: PanePrefsPort;
  /** The host's sharing operations; the project menu offers sharing only when present. */
  sharing?: ShareHost | undefined;
}

const NEW_ENTRIES: ReadonlyArray<{ kind: CreateProjectKind; label: string; icon: "file" | "layers" | "folder-open" }> = [
  { kind: "blank", label: "Blank project", icon: "file" },
  { kind: "template", label: "From template…", icon: "layers" },
  { kind: "folder", label: "Add existing folder…", icon: "folder-open" },
];

function showNewMenu(anchor: HTMLElement, post: AllProjectsTransport["post"], kinds: readonly CreateProjectKind[]): void {
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
    if (message.type === "error") showToast(message.message, "error");
    else if (message.type === "files") on.files(message);
    else if (message.type === "detail") on.detail(message);
    else on.projects(message);
  });
}

const toggledSort = (sort: ProjectViewState["sort"], key: ProjectSortField): ProjectViewState["sort"] =>
  sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: deriveFirstProjectSortDir(key) };

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
      if (row) showMenu(anchor, createProjectMenuEntries(row, { rows: s.rows, commands: s.commands, post, sharing: d.sharing }));
    },
    onSort: (key: ProjectSortField) => d.set({ sort: toggledSort(s.view.sort, key) }),
  };
}

function buildPageFrame(root: HTMLElement, prefs: PanePrefsPort, sharing: ShareHost | undefined): ReturnType<typeof buildFrame> {
  const frame = buildFrame(root, prefs, { withSidebar: false, withCitationMap: false, title: "Projects" });
  frame.root.classList.add("ls-all-projects");
  // Between the header and the list; the block hides itself while the host offers no project sharing.
  if (sharing) frame.list.before(mountInvitations(sharing).root);
  return frame;
}

export function mountAllProjects(root: HTMLElement, { transport, prefs, sharing }: AllProjectsChannel): void {
  const s: PageState = { view: DEFAULT_PROJECT_VIEW, rows: [], commands: [], newKinds: ["blank", "template", "folder"], selected: null };
  const post = transport.post.bind(transport);
  const frame = buildPageFrame(root, prefs, sharing);
  const set = (view: Partial<ProjectViewState>): void => { s.view = { ...s.view, ...view }; render(); };
  const rowById = (id: string): ProjectRow | undefined => s.rows.find((r) => r.id === id);
  const onNew = (anchor: HTMLElement): void => showNewMenu(anchor, post, s.newKinds);
  const details = createPaneRequests(post);
  const select = (id: string): void => { if (id !== s.selected) details.request(id); s.selected = id; render(); };
  const expansion = createProjectExpansion({ post, rowById, select, detailOf: details.get, render });
  details.onChange((id) => { if (id === s.selected || id === expansion.frame().expanded) render(); });
  const header = mountAllProjectsHeader(frame.header, {
    onPlace: (place: ProjectPlace) => { if (place !== s.view.place) { s.selected = null; set({ place }); } },
    onQuery: (query) => set({ query }),
    onNew,
    onEmptyTrash: () => void removeAllTrash(countPlaces(s.rows).trash, post),
    onLeaveSearch: () => list.focus(),
    onShare: () => { if (sharing && s.selected) void runShareProjectDialog(sharing, s.selected); },
  });
  const list = mountProjectList(frame.list, rowHandlers({ s, post, rowById, select, set, sharing }, expansion.handlers));
  const selection = reportSelection(post);

  function render(): void {
    const groups = deriveProjectView(s.rows, s.view);
    const shown = new Set(groups.flatMap((g) => g.rows.map((r) => r.id)));
    if (s.selected && !shown.has(s.selected)) s.selected = null;
    expansion.keepShown(shown);
    header.paint(s.view.place, countPlaces(s.rows), s.view.query);
    header.setShare(shareState(sharing, s.selected));
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
  sharing?.onOffersChange(render);
  render();
  post({ type: "ready" });
  selection.start(s.selected);
}

/** The header's Share button: the selected project, when the host offers project sharing. */
function shareState(sharing: ShareHost | undefined, selected: string | null): { disabled: boolean; title: string } {
  if (!selected) return { disabled: true, title: "Select a project to share" };
  if (!sharing?.offers().projects) return { disabled: true, title: "Project sharing is not available here" };
  return { disabled: false, title: "Share the selected project" };
}

/** Posts `project.selected` once per change, from the selection current when `start` runs after `ready`. */
function reportSelection(post: (m: AllProjectsToHost) => void): { start(id: string | null): void; update(id: string | null): void } {
  // INVARIANT: undefined until `start`, so the host never hears a selection before the page's `ready`.
  let reported: string | null | undefined;
  const send = (id: string | null): void => { reported = id; post({ type: "project.selected", id }); };
  return { start: send, update: (id) => { if (reported !== undefined && id !== reported) send(id); } };
}
