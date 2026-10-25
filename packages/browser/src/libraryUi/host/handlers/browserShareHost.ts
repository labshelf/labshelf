// Builds the sharing host of the library page: paper-folder links over this browser's share list, library files and relay, plus the projects the project wiring adds.
import { createSharingHost, createWorkerShareReader, PAPERS_DIR, PaperDataStore, posixPathOps, relayBackendFor, type ILogger, type RelayAccount } from "@labshelf/core";
import { bx } from "../../../platform";
import { createBrowserShareRegistryStore } from "../../../share";
import { createLibraryFileSystem, createSidecarPort, currentLibraryId } from "../../../storage";
import type { HostContext } from "../hostContext";
import { createPageSharingHost, type PageSharingHost } from "./pageShareHost";

/** The owner's Cloudflare relay as the share links need it. */
export interface ShareLinkRelay {
  /** The connected account, or a connect the owner confirms first; undefined on cancel or failure (already shown). */
  requireRelay(): Promise<RelayAccount | undefined>;
  /** The connected account, without offering to connect. */
  connectedRelay(): Promise<RelayAccount | undefined>;
}

export function createBrowserSharingHost(ctx: HostContext, relay: ShareLinkRelay, logger: ILogger): PageSharingHost {
  const fs = createLibraryFileSystem();
  const sidecars = new PaperDataStore(createSidecarPort(fs), { logger });
  return createPageSharingHost((projects) => createSharingHost({
    place: "this browser",
    logger,
    ...(projects ? { projects } : {}),
    links: {
      papers: () => ctx.snapshots.current().papers,
      papersRoot: PAPERS_DIR,
      sep: "/",
      sources: { fs, paths: posixPathOps, annotations: (paperId) => sidecars.getAnnotations(paperId) },
      registry: createBrowserShareRegistryStore({ get: (key) => bx.storage.local.get(key), set: (items) => bx.storage.local.set(items) }, currentLibraryId),
      relay: { require: relay.requireRelay, connected: relay.connectedRelay },
      backendFor: relayBackendFor,
      readerFor: (relayUrl) => createWorkerShareReader({ relayUrl }),
      importLink: (options) => ctx.mutations.importShareLink(options),
      refresh: () => ctx.snapshots.refresh(),
      openFolder: async (folder) => { ctx.endpoint.post({ type: "navigate", folder }); },
    },
    clipboard: { write: (text) => navigator.clipboard.writeText(text) },
    // The link key sits in the fragment, which the new tab never sends to a server.
    openLink: async (url) => { window.open(url, "_blank", "noopener"); },
  }));
}
