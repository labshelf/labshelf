// Opens and closes the project shown in the library page: its tabs, the sidebar's trees and what a tree click does.
import type { ChecklistGrouping, ILogger, ProjectEntry, ProjectTreeView, SidebarOpenProject } from "@labshelf/core";
import { parseTab } from "../../libraryUi/editorArea";
import type { Workspace } from "../../libraryUi/editorArea";
import type { OpenProjectSnapshot } from "./openProjectSnapshot";

const MODULE = "writing.session";

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
