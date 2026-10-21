// Wires the page's sharing to the common join dialog, the owner's relay and the storage-failure notice, and keeps it in step with the page's life.
import { offerOwnRelayToShares, persistenceFailureNotices, withdrawOwnRelayFromShares, type ILogger, type RelayAccount, type SharingHost } from "@labshelf/core";
import { runJoinProjectDialog, toast } from "@labshelf/core/dom";
import type { PageRelay } from "../../relay";
import { currentLibraryId, librarySources } from "../../storage";
import { createPageSharing, resumeReports, type PageSharing } from "../editor/collab";

export interface PageSharingWiringOptions {
  logger: ILogger;
  /** The page's sharing host, which the join dialog runs against. */
  host: SharingHost;
  relay: Pick<PageRelay, "requireBrowserRelay">;
  relayAccounts: { get(): Promise<RelayAccount | undefined> };
}

export interface PageSharingWiring {
  sharing: PageSharing;
  /** Asks for an invite, unless a link carried one, and joins its shared project. */
  join(invite?: string): Promise<void>;
  offerRelayToShares(): Promise<void>;
  withdrawRelayFromShares(relayUrl: string): Promise<void>;
}

export function wirePageSharing({ logger, host, relay, relayAccounts }: PageSharingWiringOptions): PageSharingWiring {
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
