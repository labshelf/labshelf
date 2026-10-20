// Runs the share-link flows over the library page host: this library's share list, its papers and files, and the UI's progress and notices.
import { PaperDataStore, posixPathOps } from "@labshelf/core";
import { bx } from "../../../platform";
import { createBrowserShareRegistryStore, importShareFlow, manageSharesFlow, shareFolderFlow, type ShareLinkPage, type ShareLinkRelay } from "../../../share";
import { createLibraryFileSystem, createSidecarPort, currentLibraryId } from "../../../storage";
import type { HostContext } from "../hostContext";

const PROGRESS_KEY = "share-link";

export interface ShareLinkHandlers {
  shareFolder(dir: string): Promise<void>;
  manage(): Promise<void>;
  importLink(): Promise<void>;
}

export function createShareLinkHandlers(ctx: HostContext, relay: ShareLinkRelay): ShareLinkHandlers {
  const fs = createLibraryFileSystem();
  const sidecars = new PaperDataStore(createSidecarPort(fs), { logger: ctx.log });
  const page: ShareLinkPage = {
    logger: ctx.log, relay,
    registry: createBrowserShareRegistryStore({ get: (key) => bx.storage.local.get(key), set: (items) => bx.storage.local.set(items) }, currentLibraryId),
    papers: () => ctx.snapshots.current().papers,
    sources: { fs, paths: posixPathOps, annotations: (paperId) => sidecars.getAnnotations(paperId) },
    importLink: (options) => ctx.mutations.importShareLink(options),
    progress: (text) => ctx.endpoint.post({ type: "progress", key: PROGRESS_KEY, text }),
    notice: ctx.notice,
    refresh: () => ctx.snapshots.refresh(),
    openFolder: (folder) => ctx.endpoint.post({ type: "navigate", folder }),
  };
  return {
    shareFolder: (dir) => shareFolderFlow(page, dir),
    manage: () => manageSharesFlow(page),
    importLink: () => importShareFlow(page),
  };
}
