// Declares what the browser's share-link flows run over on a library page, and how they report a failure.
import { errorMessage, type FolderShareSources, type ILogger, type PaperRecord, type RelayAccount, type ShareRegistryStore } from "@labshelf/core";
import type { LibraryMutations } from "../storage";

export const LOG_MODULE = "share";

/** The owner's Cloudflare relay as the share-link flows need it. */
export interface ShareLinkRelay {
  /** The connected account, or a connect the owner confirms first; undefined on cancel or failure (already shown). */
  requireRelay(): Promise<RelayAccount | undefined>;
  /** The connected account, without offering to connect. */
  connectedRelay(): Promise<RelayAccount | undefined>;
}

export interface ShareLinkPage {
  logger: ILogger;
  relay: ShareLinkRelay;
  /** This library's list of the shares this browser made. */
  registry: ShareRegistryStore;
  /** Every paper of the library, as the page shows it now. */
  papers(): readonly PaperRecord[];
  sources: FolderShareSources;
  importLink: LibraryMutations["importShareLink"];
  /** Shows what a running share or import is doing; null clears it. */
  progress(text: string | null): void;
  notice(kind: "info" | "ok" | "error", text: string): void;
  /** Re-reads the library after an import, so the view lists the papers it added. */
  refresh(): Promise<void>;
  openFolder(folder: string): void;
}

/** `context` must hold no link key, owner secret or token. */
export function reportShareFailure(page: Pick<ShareLinkPage, "logger" | "notice">, action: string, error: unknown, context: Record<string, unknown>): void {
  void page.logger.error(LOG_MODULE, error, { ...context, action });
  page.notice("error", `LabShelf could not ${action}: ${errorMessage(error)}`);
}

/** Opens a share link in a new tab; the key stays in the fragment, which the tab never sends to a server. */
export function openLinkInTab(link: string): void {
  window.open(link, "_blank", "noopener");
}
