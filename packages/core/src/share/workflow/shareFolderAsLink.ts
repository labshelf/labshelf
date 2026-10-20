// Shares a library folder as a link: reads its papers, encrypts them and uploads the share to the owner's relay.
import type { ILogger } from "../../ports/index.js";
import type { PaperRecord } from "../../model/index.js";
import { buildShare } from "../buildShare.js";
import type { ShareBackend } from "../shareBackend.js";
import type { ShareRegistryStore } from "../shareRegistry.js";
import { uploadShare } from "../uploadShare.js";
import { papersInFolder, sharePaperInputs, type FolderShareSources } from "./folderSharePapers.js";

export type ShareFolderStage = "reading" | "encrypting" | "uploading";

export interface ShareFolderAsLinkOptions {
  /** Every paper of the library; the share holds those under `folder` at any depth. */
  papers: readonly PaperRecord[];
  folder: string;
  withAnnotations: boolean;
  sources: FolderShareSources;
  relayUrl: string;
  backendFor: (relayUrl: string) => ShareBackend;
  registry: ShareRegistryStore;
  logger: ILogger;
  onStage?: (stage: ShareFolderStage) => void;
}

/** Holds no link key, so a host can log it. */
export type ShareFolderSummary = { shareId: string; folder: string; papers: number; withAnnotations: boolean; relayUrl: string };

export interface SharedFolderLink { link: string; summary: ShareFolderSummary }

// CONTRACT: documents/contracts/share-link.md#upload-and-revoke
export async function shareFolderAsLink(options: ShareFolderAsLinkOptions): Promise<SharedFolderLink> {
  const { folder, withAnnotations, sources, relayUrl, onStage } = options;
  onStage?.("reading");
  const papers = papersInFolder(options.papers, folder, sources.paths.sep);
  const inputs = await sharePaperInputs(papers, withAnnotations, sources);
  onStage?.("encrypting");
  const share = await buildShare({ folderName: sources.paths.basename(folder), papers: inputs, withAnnotations });
  onStage?.("uploading");
  const link = await uploadShare({ share, relayUrl, backend: options.backendFor(relayUrl), registry: options.registry, logger: options.logger });
  return { link, summary: { shareId: share.shareId, folder, papers: papers.length, withAnnotations, relayUrl } };
}
