// Creates the page's project services (sharing, helper, session, comments) and starts them once the workspace has restored its tabs.
import {
  type ILogger,
  type LibraryFileSystem,
  type ProjectSharingDeps,
  type RelayAccount,
  type SharingHost,
  offerOwnRelayToShares,
  persistenceFailureNotices,
  withdrawOwnRelayFromShares,
} from "@labshelf/core";
import { createBrowserLatexHelper } from "../helper/client";
import { getSettings } from "../platform";
import { updateOwnRelayOnStart, type PageRelay } from "../relay";
import { createBrowserProjects } from "../storage/browserProjects";
import { createHelperProject } from "../helper/project";
import { revealInOpenEditor } from "../writing/session";
import { createProjectsSource, showPdfInTab } from "../writing/projectList";
import { createCommentThreads, createRoutedCommentThreads } from "../collab/comments";
import { createOpenProjectSnapshot, createProjectSession, resumeRestoredProject } from "../writing/session";
import { createSidebarProjects, type SidebarProjects } from "../libraryUi/sidebar";
import type { ProjectServices, TabKindName } from "../libraryUi/editorArea";
import type { Workspace } from "../libraryUi/editorArea";
import { runJoinProjectDialog, toast } from "@labshelf/core/dom";
import { currentLibraryId, librarySources } from "../storage";
import { createPageSharing, resumeReports, type PageSharing } from "../collab";

interface PageSharingWiringOptions {
  logger: ILogger;
  /** The page's sharing host, which the join dialog runs against. */
  host: SharingHost;
  relay: Pick<PageRelay, "requireBrowserRelay">;
  relayAccounts: { get(): Promise<RelayAccount | undefined> };
}

interface PageSharingWiring {
  sharing: PageSharing;
  /** Asks for an invite, unless a link carried one, and joins its shared project. */
  join(invite?: string): Promise<void>;
  offerRelayToShares(): Promise<void>;
  withdrawRelayFromShares(relayUrl: string): Promise<void>;
}

function wirePageSharing({ logger, host, relay, relayAccounts }: PageSharingWiringOptions): PageSharingWiring {
  const join = async (invite?: string): Promise<void> => {
    // The join finds the share's project only in a project list that was read.
    await sharing.ready();
    await runJoinProjectDialog(host, invite);
  };
  const sharing = createPageSharing({
    sources: librarySources(), libraryId: currentLibraryId, logger, relay: relayAccounts,
    requireRelay: async () => (await relay.requireBrowserRelay()) !== undefined,
    reports: resumeReports(() => { void join(); }),
  });
  sharing.shares.onChange(persistenceFailureNotices(sharing.ports, "page", (message) => toast(message, "error")));
  window.addEventListener("pagehide", () => { void sharing.closeAll(); });
  // Another tab may have shared, left or trashed a project while this one was hidden.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void sharing.reload(); });
  return {
    sharing, join,
    offerRelayToShares: async () => {
      const refused = await offerOwnRelayToShares(sharing.ports);
      if (refused.length === 0) return;
      const projects = refused.length === 1 ? "1 shared project" : `${refused.length} shared projects`;
      toast(`Your relay did not take ${projects} open on this page. Their collaborators reach them through the relays they list.`, "error");
    },
    withdrawRelayFromShares: (relayUrl) => withdrawOwnRelayFromShares(sharing.ports, relayUrl),
  };
}

export interface ProjectWiringOptions {
  workspace: Workspace;
  fs: LibraryFileSystem;
  logger: ILogger;
  openTab: (kind: TabKindName) => void;
  /** Asks the owner to connect Cloudflare when a share needs a relay. */
  relay: Pick<PageRelay, "requireBrowserRelay">;
  relayAccounts: { get(): Promise<RelayAccount | undefined> };
  /** The page's sharing host; the join dialog runs against it once it holds `projectSharing`. */
  sharing: SharingHost;
}

export interface ProjectWiring {
  services: ProjectServices;
  /** The project half of the page's sharing host. */
  projectSharing: ProjectSharingDeps;
  /** Builds the sidebar's Projects section. */
  sidebarProjects(): SidebarProjects;
  /** Reopens the project the restored tabs name, then joins the share link the page was opened with. */
  start(invite: string | undefined): void;
  /** Offers the owner's relay to the shares connected on this page, once Cloudflare is connected. */
  offerRelayToShares(): Promise<void>;
  /** Takes the owner's relay out of this library's shares, once Cloudflare is disconnected. */
  withdrawRelayFromShares(relayUrl: string): Promise<void>;
}

export function mountProjectWiring({ workspace, fs, logger, openTab, relay, relayAccounts, sharing: host }: ProjectWiringOptions): ProjectWiring {
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
  const wired = wirePageSharing({ logger, host, relay, relayAccounts });
  const { sharing } = wired;
  const comments = createRoutedCommentThreads({ files: createCommentThreads({ fs, session, logger }), shares: sharing.shares, session });
  // Never awaited: mounting does not wait on the network.
  void updateOwnRelayOnStart(logger);
  return {
    services: { session, helperProject, comments, sharing },
    // Every surface keys a project by its folder, as the open-project snapshot does.
    projectSharing: { ports: sharing.ports, idOf: (entry) => entry.folder, open: async (entry) => { await session.openProject(entry); } },
    sidebarProjects: () => {
      const source = createProjectsSource({ projects: createBrowserProjects({ fileSystem: fs, logger }), fileSystem: fs, logger, showPdf: showPdfInTab });
      return createSidebarProjects(source, openTab, session, host, sharing.onProjectsChange);
    },
    start: (invite) => {
      void resumeRestoredProject(workspace, session, fs, logger);
      if (invite !== undefined) void wired.join(invite);
    },
    offerRelayToShares: wired.offerRelayToShares,
    withdrawRelayFromShares: wired.withdrawRelayFromShares,
  };
}
