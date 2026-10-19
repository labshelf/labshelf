// Opens and closes the project shown in the library page: its tabs, the sidebar's trees and what a tree click does.
import type { ChecklistGrouping, ILogger, ProjectEntry, ProjectTreeView, SidebarOpenProject } from "@labshelf/core";
import { parseTabId } from "../tabs";
import type { Workspace } from "../workspace";
import type { OpenProjectSnapshot } from "./openProjectSnapshot";

const MODULE = "library-page.session";

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
    const tab = parseTabId(tabId);
    return tab !== null && (tab.kind === "source" || tab.kind === "preview" || tab.kind === "comments" || tab.kind === "history") && tab.params["projectId"] === projectId;
  };
}

export function createProjectSession({ workspace, snapshot, logger, onReveal, onProjectChange }: ProjectSessionOptions): ProjectSession {
  let sidebar: SessionSidebar | undefined;
  let open: ProjectEntry | undefined;
  let grouping: ChecklistGrouping = "kind";
  // Bumped by every open and close, so a snapshot that finishes after the project changed is dropped.
  let generation = 0;

  const notifyChange = async (entry: ProjectEntry | undefined): Promise<void> => {
    try {
      await onProjectChange?.(entry);
    } catch (error) {
      await logger.error(MODULE, error, { action: "notify project change", folder: entry?.folder });
    }
  };

  async function publish(entry: ProjectEntry, mine: number): Promise<void> {
    try {
      const built = await snapshot(entry, grouping);
      if (mine === generation) { sidebar?.setOpenProject(built); }
    } catch (error) {
      await logger.error(MODULE, error, { action: "build open project snapshot", folder: entry.folder });
    }
  }

  const session: ProjectSession = {
    async openProject(entry) {
      const id = projectIdOf(entry);
      if (id === undefined) {
        await logger.log("WARN", MODULE, "A broken project cannot be opened", { folder: entry.folder });
        return false;
      }
      if (open !== undefined && projectIdOf(open) !== id && !(await session.closeProject())) { return false; }
      open = entry;
      const mine = ++generation;
      const main = mainOf(entry);
      if (main !== undefined) { workspace.openTab("source", { projectId: id, path: main }, 0); }
      workspace.openTab("preview", { projectId: id }, 1);
      sidebar?.collapseLibrary();
      await publish(entry, mine);
      await notifyChange(entry);
      return true;
    },
    async closeProject() {
      if (open === undefined) { return true; }
      const id = projectIdOf(open);
      if (id !== undefined && !(await workspace.closeTabs(belongsTo(id)))) { return false; }
      open = undefined;
      generation += 1;
      sidebar?.setOpenProject(undefined);
      await notifyChange(undefined);
      return true;
    },
    current: () => open,
    attachSidebar(next) { sidebar = next; },
    treeClick(view, key) {
      const id = open === undefined ? undefined : projectIdOf(open);
      if (id === undefined) { return; }
      if (view === "files") { workspace.openTab("source", { projectId: id, path: key }, 0); return; }
      if (view !== "outline") { return; }
      const colon = key.lastIndexOf(":");
      const line = Number(key.slice(colon + 1));
      if (colon > 0 && Number.isInteger(line)) { onReveal?.(key.slice(0, colon), line); }
    },
    async treeAction(action) {
      const id = open === undefined ? undefined : projectIdOf(open);
      if (open === undefined || id === undefined) { return; }
      if (action === "comments") { workspace.openTab("comments", { projectId: id }, 1); return; }
      if (action === "history") { workspace.openTab("history", { projectId: id }, 1); return; }
      if (action !== "byKind" && action !== "bySection") { return; }
      grouping = action === "byKind" ? "kind" : "section";
      await publish(open, ++generation);
    },
  };
  return session;
}
