// Creates the page's project services (sharing, helper, session, comments) and starts them once the workspace has restored its tabs.
import type { ILogger, LibraryFileSystem, RelayAccount } from "@labshelf/core";
import { createBrowserLatexHelper } from "../../helper/client";
import { getSettings } from "../../platform";
import { updateOwnRelayOnStart, type PageRelay } from "../../relay";
import { createBrowserProjects } from "../../storage/projects";
import { createHelperProject } from "../helperProject";
import { revealInOpenEditor } from "../openEditors";
import { createProjectsSource, showPdfInTab } from "../projects";
import { wirePageSharing } from "./pageSharingWiring";
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
  /** Asks the owner to connect Cloudflare when a share needs a relay. */
  relay: Pick<PageRelay, "requireBrowserRelay">;
  relayAccounts: { get(): Promise<RelayAccount | undefined> };
}

export interface ProjectWiring {
  services: ProjectServices;
  /** Builds the sidebar's Projects section. */
  sidebarProjects(): SidebarProjects;
  /** Reopens the project the restored tabs name, then joins the share link the page was opened with. */
  start(invite: string | undefined): void;
  /** Offers the owner's relay to the shares connected on this page, once Cloudflare is connected. */
  offerRelayToShares(): Promise<void>;
  /** Takes the owner's relay out of this library's shares, once Cloudflare is disconnected. */
  withdrawRelayFromShares(relayUrl: string): Promise<void>;
}

export function mountProjectWiring({ workspace, fs, logger, openTab, relay, relayAccounts }: ProjectWiringOptions): ProjectWiring {
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
  const wired = wirePageSharing({ logger, session, relay, relayAccounts });
  const { sharing } = wired;
  const comments = createRoutedCommentThreads({ files: createCommentThreads({ fs, session, logger }), shares: sharing.shares, session });
  // Never awaited: mounting does not wait on the network.
  void updateOwnRelayOnStart(logger);
  return {
    services: { session, helperProject, comments, sharing },
    sidebarProjects: () => {
      const source = createProjectsSource({ projects: createBrowserProjects({ fileSystem: fs, logger }), fileSystem: fs, logger, showPdf: showPdfInTab });
      return createSidebarProjects(source, openTab, session, { join: () => { void wired.join(); }, menu: wired.menu });
    },
    start: (invite) => {
      void resumeRestoredProject(workspace, session, fs, logger);
      if (invite !== undefined) void wired.join(invite);
    },
    offerRelayToShares: wired.offerRelayToShares,
    withdrawRelayFromShares: wired.withdrawRelayFromShares,
  };
}
