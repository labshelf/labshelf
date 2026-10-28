// Keeps the page's project session: its open source editors, the sidebar snapshot it publishes, opening and closing the project and reopening a restored one.
import {
  parseTab, buildChecklist, deriveChecklistSidebarNodes, deriveCitationSections, deriveNestedHeadings, findOutlineHeadings, posixPathOps, listProjectFileTree, readChecklistSignals, createSectionPlacer,
  type ChecklistGrouping, type HeadingNode, type ILogger, type LibraryFileSystem, type OutlineHeading, type ProjectEntry, type ProjectReadContext, type ProjectTreeView,
  type SidebarOpenProject, type SidebarProjectTree, type SidebarTreeNode,
} from "@labshelf/core";
import type { Workspace } from "../libraryUi/editorArea";

export interface OpenEditor {
  /** Scrolls to the zero-based line and selects it. */
  revealLine(line: number): void;
  /** Writes pending edits now; resolves whether the file is saved afterwards. */
  flush(): Promise<boolean>;
  /** Replaces the editor's text with the file's text on disk, without marking it dirty. */
  reload(): Promise<void>;
}

const editors = new Map<string, OpenEditor>();
const pending = new Map<string, number>();
// INVARIANT: encodeURIComponent escapes ":", so the project part of a key never runs into its path part.
const projectPrefix = (projectId: string): string => `${encodeURIComponent(projectId)}:`;
const keyOf = (projectId: string, path: string): string => `${projectPrefix(projectId)}${encodeURIComponent(path)}`;
const editorsOf = (projectId: string): OpenEditor[] =>
  [...editors].filter(([key]) => key.startsWith(projectPrefix(projectId))).map(([, editor]) => editor);

/** Loads the CodeMirror source editor in its own chunk, so a page downloads it only when it opens a source file. */
export function loadSourceEditor(): Promise<typeof import("./editor.js")> {
  return import("./editor.js");
}

/** Adds a mounted editor and applies a reveal asked for before it mounted; returns the call that removes it. */
export function registerOpenEditor(projectId: string, path: string, editor: OpenEditor): () => void {
  const key = keyOf(projectId, path);
  editors.set(key, editor);
  const line = pending.get(key);
  if (line !== undefined) {
    pending.delete(key);
    editor.revealLine(line);
  }
  return () => { if (editors.get(key) === editor) editors.delete(key); };
}

/** Reveals the line in the file's editor; when none is mounted yet (its tab is still loading), the editor reveals it on mount. */
export function showInOpenEditor(projectId: string, path: string, line: number): void {
  const key = keyOf(projectId, path);
  const editor = editors.get(key);
  if (editor) editor.revealLine(line);
  else pending.set(key, line);
}

/** Saves the pending edits of every open editor of the project; resolves whether all of them are saved. */
export async function writeProjectEditors(projectId: string): Promise<boolean> {
  const saved = await Promise.all(editorsOf(projectId).map((editor) => editor.flush()));
  return saved.every(Boolean);
}

/** Reloads every open editor of the project from disk. */
export async function refreshProjectEditors(projectId: string): Promise<void> {
  await Promise.all(editorsOf(projectId).map((editor) => editor.reload()));
}

const MODULE = "writing.session";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export type OpenProjectSnapshot = (entry: ProjectEntry, grouping: ChecklistGrouping) => Promise<SidebarOpenProject>;

export interface OpenProjectSnapshotOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
}

function outlineNodes(main: string, headings: HeadingNode<OutlineHeading>[]): SidebarTreeNode[] {
  return headings.map(({ entry, children }) => ({
    key: `${main}:${entry.line}`,
    label: entry.title || "Untitled",
    clickable: true,
    ...(children.length > 0 ? { children: outlineNodes(main, children), open: true } : {}),
  }));
}

async function readOutline(context: ProjectReadContext, project: ReadyProject): Promise<SidebarTreeNode[]> {
  if (project.main === undefined) { return []; }
  const text = await context.fs.readText(context.paths.join(project.folder, project.main));
  return outlineNodes(project.main, deriveNestedHeadings(findOutlineHeadings(project.settings.format, text)));
}

async function checklistNodes(context: ProjectReadContext, project: ReadyProject, grouping: ChecklistGrouping): Promise<SidebarTreeNode[]> {
  const signals = await readChecklistSignals(context, project);
  const main = project.main ?? "";
  const checklist = buildChecklist({
    ...signals, pageOverflow: undefined, reading: [], placeSection: createSectionPlacer(signals.sources, main), citeSections: deriveCitationSections(signals.sources, main),
  }, grouping);
  return deriveChecklistSidebarNodes({ paths: posixPathOps, checklist, grouping, pageCount: undefined, reading: new Map(), isExpanded: (_, byDefault) => byDefault }).nodes;
}

export function createOpenProjectSnapshot({ fs, logger }: OpenProjectSnapshotOptions): OpenProjectSnapshot {
  const context: ProjectReadContext = { fs, paths: posixPathOps, logger };

  // One unreadable tree must not blank the others: it is logged and shown empty.
  const guard = async (view: SidebarProjectTree["view"], project: ReadyProject, build: () => Promise<SidebarTreeNode[]>): Promise<SidebarTreeNode[]> => {
    try { return await build(); } catch (error) {
      await logger.error(MODULE, error, { action: "build sidebar tree", view, folder: project.folder });
      return [];
    }
  };

  return async (entry, grouping) => {
    if (entry.kind !== "ready") { throw new Error(`${entry.folder}: a broken project has no sidebar trees`); }
    const [files, outline, checklist] = await Promise.all([
      guard("files", entry, () => listProjectFileTree(context, entry, entry.folder, "")),
      guard("outline", entry, () => readOutline(context, entry)),
      guard("checklist", entry, () => checklistNodes(context, entry, grouping)),
    ]);
    return {
      id: entry.folder, name: entry.settings.title ?? entry.settings.id, format: entry.settings.format,
      trees: [
        { view: "files", title: "Files", actions: [{ action: "history", label: "History", icon: "history" }, { action: "comments", label: "Comments", icon: "message" }], nodes: files, empty: "No files." },
        { view: "outline", title: "Outline", actions: [], nodes: outline, empty: "Open a source file to see its outline." },
        {
          view: "checklist", title: "Checklist", actions: [], nodes: checklist, empty: "Nothing to do.",
          toggle: { options: [{ action: "byKind", label: "By kind" }, { action: "bySection", label: "By section" }], selected: grouping === "kind" ? "byKind" : "bySection" },
        },
      ],
    };
  };
}


/** What the session drives in the sidebar. */
interface SessionSidebar {
  setOpenProject(snapshot: SidebarOpenProject | undefined): void;
  collapseLibrary(): void;
}

export interface ProjectSessionOptions {
  workspace: Pick<Workspace, "openTab" | "closeTabs">;
  snapshot: OpenProjectSnapshot;
  logger: ILogger;
  /** Called for an outline click with the file and the zero-based line of the heading. */
  onReveal?: (path: string, line: number) => void;
  /** Called after a project opens (with its entry) and after it closes (undefined). */
  onProjectChange?: (entry: ProjectEntry | undefined) => void | Promise<void>;
}

export interface ProjectSession {
  /** Closes another open project first; false when that stayed open or the entry cannot be opened. */
  openProject(entry: ProjectEntry): Promise<boolean>;
  /** Closes the open project's tabs; false when one stayed open. */
  closeProject(): Promise<boolean>;
  current(): ProjectEntry | undefined;
  attachSidebar(sidebar: SessionSidebar): void;
  treeClick(view: ProjectTreeView, key: string): void;
  /** Runs a toolbar or toggle action of a tree: byKind and bySection switch the checklist grouping. */
  treeAction(action: string): Promise<void>;
}

const projectIdOf = (entry: ProjectEntry): string | undefined => (entry.kind === "ready" ? entry.settings.id : undefined);
const mainOf = (entry: ProjectEntry): string | undefined => (entry.kind === "ready" ? entry.main : undefined);

function belongsTo(projectId: string): (tabId: string) => boolean {
  return (tabId) => {
    const tab = parseTab(tabId);
    return tab !== null && (tab.kind === "source" || tab.kind === "preview" || tab.kind === "comments" || tab.kind === "history") && tab.params["projectId"] === projectId;
  };
}

async function notifyProjectChange({ logger, onProjectChange }: Pick<ProjectSessionOptions, "logger" | "onProjectChange">, entry: ProjectEntry | undefined): Promise<void> {
  try {
    await onProjectChange?.(entry);
  } catch (error) {
    await logger.error(MODULE, error, { action: "notify project change", folder: entry?.folder });
  }
}

/** A click in the files tree opens the file; one in the outline reveals the heading (its key is the path, a colon and the zero-based line). */
function clickTree({ workspace, onReveal }: Pick<ProjectSessionOptions, "workspace" | "onReveal">, projectId: string, view: ProjectTreeView, key: string): void {
  if (view === "files") { workspace.openTab("source", { projectId, path: key }, 0); return; }
  if (view !== "outline") { return; }
  const colon = key.lastIndexOf(":");
  const line = Number(key.slice(colon + 1));
  if (colon > 0 && Number.isInteger(line)) { onReveal?.(key.slice(0, colon), line); }
}

/** What the session remembers between calls. */
interface SessionState {
  sidebar: SessionSidebar | undefined;
  open: ProjectEntry | undefined;
  grouping: ChecklistGrouping;
  // Bumped by every open and close, so a snapshot that finishes after the project changed is dropped.
  generation: number;
}

type SessionContext = ProjectSessionOptions & { state: SessionState };

async function publish({ snapshot, logger, state }: SessionContext, entry: ProjectEntry, mine: number): Promise<void> {
  try {
    const built = await snapshot(entry, state.grouping);
    if (mine === state.generation) { state.sidebar?.setOpenProject(built); }
  } catch (error) {
    await logger.error(MODULE, error, { action: "build open project snapshot", folder: entry.folder });
  }
}

async function openProject(context: SessionContext, session: ProjectSession, entry: ProjectEntry): Promise<boolean> {
  const { workspace, logger, state } = context;
  const id = projectIdOf(entry);
  if (id === undefined) {
    await logger.log("WARN", MODULE, "A broken project cannot be opened", { folder: entry.folder });
    return false;
  }
  if (state.open !== undefined && projectIdOf(state.open) !== id && !(await session.closeProject())) { return false; }
  state.open = entry;
  const mine = ++state.generation;
  const main = mainOf(entry);
  if (main !== undefined) { workspace.openTab("source", { projectId: id, path: main }, 0); }
  workspace.openTab("preview", { projectId: id }, 1);
  state.sidebar?.collapseLibrary();
  await publish(context, entry, mine);
  await notifyProjectChange(context, entry);
  return true;
}

async function closeProject(context: SessionContext): Promise<boolean> {
  const { workspace, state } = context;
  if (state.open === undefined) { return true; }
  const id = projectIdOf(state.open);
  if (id !== undefined && !(await workspace.closeTabs(belongsTo(id)))) { return false; }
  state.open = undefined;
  state.generation += 1;
  state.sidebar?.setOpenProject(undefined);
  await notifyProjectChange(context, undefined);
  return true;
}

async function runTreeAction(context: SessionContext, action: string): Promise<void> {
  const { workspace, state } = context;
  const id = state.open === undefined ? undefined : projectIdOf(state.open);
  if (state.open === undefined || id === undefined) { return; }
  if (action === "comments" || action === "history") { workspace.openTab(action, { projectId: id }, 1); return; }
  if (action !== "byKind" && action !== "bySection") { return; }
  state.grouping = action === "byKind" ? "kind" : "section";
  await publish(context, state.open, ++state.generation);
}

export function createProjectSession(options: ProjectSessionOptions): ProjectSession {
  const context: SessionContext = { ...options, state: { sidebar: undefined, open: undefined, grouping: "kind", generation: 0 } };
  const { state } = context;
  const session: ProjectSession = {
    openProject: (entry) => openProject(context, session, entry),
    closeProject: () => closeProject(context),
    current: () => state.open,
    attachSidebar(next) { state.sidebar = next; },
    treeClick(view, key) {
      const id = state.open === undefined ? undefined : projectIdOf(state.open);
      if (id !== undefined) { clickTree(context, id, view, key); }
    },
    treeAction: (action) => runTreeAction(context, action),
  };
  return session;
}


export async function openRestoredProject(workspace: Pick<Workspace, "tabs" | "openTab">, session: ProjectSession, fs: LibraryFileSystem, logger: ILogger): Promise<void> {
  const tabs = workspace.tabs();
  const projectId = tabs.map((t) => parseTab(t.id)?.params["projectId"]).find((id) => id !== undefined);
  if (projectId === undefined) return;
  try {
    // Loaded on demand, so a page without project tabs never loads the project code.
    const { findProject } = await import("./project");
    if (!(await session.openProject(await findProject(fs, logger, undefined, projectId)))) return;
  } catch (error) {
    await logger.error(MODULE, error, { action: "resume restored project", projectId });
    return;
  }
  // Opening the project focuses its main file; the tab the page was showing is focused again.
  const focused = tabs.find((t) => t.focused);
  const tab = focused === undefined ? null : parseTab(focused.id);
  if (tab) workspace.openTab(tab.kind, tab.params);
}
