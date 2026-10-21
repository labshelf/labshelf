// Runs the paper-folder-link operations of a sharing host over the core share workflows.
import { isUnderDir } from "../../../library/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { RelayAccount } from "../../../relay/index.js";
import {
  loadShareRegistry, OPEN_SHARE_FAILURE, refusedShareLinkText, revokeShare, shareableFolders, shareFolderAsLink, shareImportSummaryText, shareRecordLink,
  type FolderShareSources, type ImportShareLinkOptions, type ImportShareLinkResult, type ShareBackend, type ShareReader, type ShareRegistryStore,
} from "../../../share/index.js";
import type { ImportLinkResult, SharingHost } from "../sharingHost.js";

export interface FolderLinkDeps {
  papers(): readonly PaperRecord[];
  papersRoot: string;
  sep: string;
  sources: FolderShareSources;
  registry: ShareRegistryStore;
  relay: { require(): Promise<RelayAccount | undefined>; connected(): Promise<RelayAccount | undefined> };
  /** Apps pass core relayBackendFor; tests pass a memory relay. */
  backendFor(account: RelayAccount | undefined): (relayUrl: string) => ShareBackend;
  readerFor(relayUrl: string): ShareReader;
  importLink(options: Pick<ImportShareLinkOptions, "text" | "readerFor" | "onProgress">): Promise<ImportShareLinkResult>;
  refresh(): Promise<void>;
  openFolder(path: string): Promise<void>;
}

export type FolderLinkOps = Pick<SharingHost, "shareableFolder" | "shareFolder" | "sharedLinks" | "revokeLink" | "importLink" | "openFolder">;

const MODULE = "share";

// The RPC guard checks only argument shapes, so every path is checked here against the host's own library.
export function createFolderLinkOps(deps: FolderLinkDeps, logger: ILogger): FolderLinkOps {
  const eligible = (path: string) => shareableFolders(deps.papers(), deps.papersRoot, deps.sep).find((folder) => folder.dir === path);

  const importResult = async (result: ImportShareLinkResult): Promise<ImportLinkResult> => {
    if (result.status === "refused") { return { kind: "failed", message: refusedShareLinkText(result.error) }; }
    if (result.status === "openFailed") { return { kind: "failed", message: OPEN_SHARE_FAILURE[result.error] }; }
    const { summary, withAnnotations } = result;
    if (summary.added.length > 0) { await deps.refresh(); }
    const text = shareImportSummaryText(summary, summary.folder ? deps.sources.paths.basename(summary.folder) : "", withAnnotations);
    return summary.folder === undefined ? { kind: "imported", summary: text } : { kind: "imported", summary: text, folder: summary.folder };
  };

  return {
    shareableFolder: async (path) => {
      const folder = eligible(path);
      return folder && { path: folder.dir, label: folder.label, count: folder.count };
    },
    shareFolder: async (path, withAnnotations, onProgress) => {
      if (!eligible(path)) { throw new Error("This folder holds no papers to share."); }
      const account = await deps.relay.require();
      if (!account) { return { kind: "noRelay" }; }
      const papers = deps.papers();
      try {
        const link = await shareFolderAsLink({
          papers, folder: path, withAnnotations, sources: deps.sources, relayUrl: account.relayUrl, backendFor: deps.backendFor(account),
          registry: deps.registry, logger, onStage: (stage) => onProgress({ stage }),
        });
        return { kind: "shared", link };
      } catch (error) {
        await logger.error(MODULE, error, { action: "shareFolder", folder: path, papers: papers.length, relayUrl: account.relayUrl });
        throw error;
      }
    },
    sharedLinks: async () => {
      const { shares } = await loadShareRegistry(deps.registry);
      return [...shares]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((record) => ({ id: record.id, folder: record.folder, link: shareRecordLink(record), createdAt: record.createdAt, relayHost: new URL(record.relayUrl).host }));
    },
    revokeLink: async (id) => revokeShare(id, { registry: deps.registry, backendFor: deps.backendFor(await deps.relay.connected()), logger }),
    importLink: async (text, onProgress) =>
      importResult(await deps.importLink({ text, readerFor: deps.readerFor, onProgress: (done, total) => onProgress({ done, total }) })),
    openFolder: async (path) => {
      if (path !== deps.papersRoot && !isUnderDir(path, deps.papersRoot, deps.sep)) { throw new Error("This folder is outside the library."); }
      await deps.openFolder(path);
    },
  };
}
