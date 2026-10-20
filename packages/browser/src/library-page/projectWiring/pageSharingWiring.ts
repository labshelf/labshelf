// Wires the page's sharing to its dialogs, the project menus and the owner's relay, and keeps it in step with the page's life.
import { offerOwnRelayToShares, withdrawOwnRelayFromShares, type ILogger, type RelayAccount } from "@labshelf/core";
import { toast, type MenuEntry } from "@labshelf/core/dom";
import type { PageRelay } from "../../relay";
import { currentLibraryId, librarySources } from "../../storage";
import { createPageSharing, resumeReports, runJoinDialog, shareMenuEntries, type PageSharing, type ShareDialogContext } from "../editor/collab";
import type { ProjectSession } from "../session";

export interface PageSharingWiringOptions {
  logger: ILogger;
  session: Pick<ProjectSession, "openProject">;
  relay: Pick<PageRelay, "requireBrowserRelay">;
  relayAccounts: { get(): Promise<RelayAccount | undefined> };
}

export interface PageSharingWiring {
  sharing: PageSharing;
  /** Asks for an invite, unless a link carried one, and joins its shared project. */
  join(invite?: string): Promise<void>;
  /** The sharing entries of the menu of the project in `folder`. */
  menu(folder: string): MenuEntry[];
  offerRelayToShares(): Promise<void>;
  withdrawRelayFromShares(relayUrl: string): Promise<void>;
}

export function wirePageSharing({ logger, session, relay, relayAccounts }: PageSharingWiringOptions): PageSharingWiring {
  const join = (invite?: string): Promise<void> => runJoinDialog({ sharing, logger, session, ...(invite === undefined ? {} : { invite }) });
  const sharing = createPageSharing({
    sources: librarySources(), libraryId: currentLibraryId, logger, relay: relayAccounts,
    requireRelay: async () => (await relay.requireBrowserRelay()) !== undefined,
    reports: resumeReports(logger, () => { void join(); }),
  });
  const dialogs: ShareDialogContext = { ports: sharing.ports, closing: sharing.closing, logger, join: () => { void join(); } };
  window.addEventListener("pagehide", () => { void sharing.closeAll(); });
  // Another tab may have shared, left or trashed a project while this one was hidden.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void sharing.reload(); });
  return {
    sharing, join,
    menu: (folder) => {
      const entry = sharing.ports.projects.list().find((candidate) => candidate.folder === folder);
      return entry?.kind === "ready" ? shareMenuEntries(dialogs, entry) : [];
    },
    offerRelayToShares: async () => {
      const refused = await offerOwnRelayToShares(sharing.ports);
      if (refused.length === 0) return;
      const projects = refused.length === 1 ? "1 shared project" : `${refused.length} shared projects`;
      toast(`Your relay did not take ${projects} open on this page. Their collaborators reach them through the relays they list.`, "error");
    },
    withdrawRelayFromShares: (relayUrl) => withdrawOwnRelayFromShares(sharing.ports, relayUrl),
  };
}
