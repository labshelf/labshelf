// Creates the page's project services (shares, helper, session, comments) and starts them once the workspace has restored its tabs.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import { createBrowserLatexHelper } from "../../helper/client";
import { getSettings } from "../../platform";
import { updateOwnRelayOnStart } from "../../relay";
import { currentLibraryId, librarySources } from "../../storage";
import { createBrowserProjects } from "../../storage/projects";
import { createPageShares, runJoinDialog } from "../editor/collab";
import { createHelperProject } from "../helperProject";
import { revealInOpenEditor } from "../openEditors";
import { createProjectsSource, showPdfInTab } from "../projects";
import { createCommentThreads, createRoutedCommentThreads } from "../review";
import { createOpenProjectSnapshot, createProjectSession, resumeRestoredProject } from "../session";
import { createSidebarProjects, type SidebarProjects } from "../sidebar";
import type { ProjectServices, TabKindName } from "../tabs";
import type { Workspace } from "../workspace";

export interface ProjectWiringOptions {
  workspace: Workspace;
  fs: LibraryFileSystem;
  logger: ILogger;
  openTab: (kind: TabKindName) => void;
}

export interface ProjectWiring {
  services: ProjectServices;
  /** Builds the sidebar's Projects section. */
  sidebarProjects(): SidebarProjects;
  /** Reopens the project the restored tabs name, then joins the share link the page was opened with. */
  start(invite: string | undefined): void;
}

export function mountProjectWiring({ workspace, fs, logger, openTab }: ProjectWiringOptions): ProjectWiring {
  const shares = createPageShares({ sources: librarySources(), libraryId: currentLibraryId, logger });
  const helperProject = createHelperProject({
    helper: createBrowserLatexHelper(logger), logger,
    buildSettings: async () => { const { autoCompile, haltOnError } = await getSettings(); return { autoCompile, haltOnError }; },
  });
  const session = createProjectSession({
    workspace, snapshot: createOpenProjectSnapshot({ fs, logger }), logger,
    onProjectChange: helperProject.projectChanged,
    onReveal: (path, line) => {
      const open = session.current();
      if (open?.kind !== "ready") return;
      workspace.openTab("source", { projectId: open.settings.id, path }, 0);
      revealInOpenEditor(open.settings.id, path, line);
    },
  });
  const comments = createRoutedCommentThreads({ files: createCommentThreads({ fs, session, logger }), shares, session });
  const joinShared = (invite?: string): Promise<void> => runJoinDialog({ shares, fs, logger, session, ...(invite === undefined ? {} : { invite }) });
  window.addEventListener("pagehide", () => { void shares.closeAll(); });
  // Never awaited: mounting does not wait on the network.
  void updateOwnRelayOnStart(logger);
  return {
    services: { session, helperProject, comments, shares },
    sidebarProjects: () => {
      const source = createProjectsSource({ projects: createBrowserProjects({ fileSystem: fs, logger }), fileSystem: fs, logger, showPdf: showPdfInTab });
      return createSidebarProjects(source, openTab, session);
    },
    start: (invite) => {
      void resumeRestoredProject(workspace, session, fs, logger);
      if (invite !== undefined) void joinShared(invite);
    },
  };
}
