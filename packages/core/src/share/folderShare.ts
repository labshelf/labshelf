// Shares a library folder as a link: reads what the share holds, encrypts and uploads it to the owner's relay, and holds the words of the messages and confirmations every app shows for share links.
import { countPapersUnder, formatFolderPathLabel, isUnderDir, createPaperFiles } from "../library/index.js";
import type { PathOps } from "../path/index.js";
import type { Annotation, PaperRecord } from "../model/index.js";
import type { LibraryFileSystem, ILogger } from "../ports/index.js";
import { type SharePaperInput, buildShare, type ShareRegistryStore, uploadShare, type OpenShareError } from "./shareFlows.js";
import type { ShareBackend } from "./shareBackend.js";
import type { SharedImportOutcome } from "./shareImport.js";
import { formatError } from "../errors/index.js";

export interface FolderShareSources {
  fs: Pick<LibraryFileSystem, "exists" | "readText" | "readFile">;
  paths: Pick<PathOps, "join" | "basename" | "sep">;
  annotations(paperId: string): Promise<Annotation[]>;
}

export interface ShareableFolder { dir: string; label: string; count: number }

/** Every folder below the library root that holds a paper at any depth, by its label. */
export function listShareableFolders(papers: readonly PaperRecord[], papersRoot: string, sep: string): ShareableFolder[] {
  const paths = papers.map((paper) => paper.path);
  const dirs = new Set<string>();
  for (const path of paths) {
    for (let dir = path.slice(0, path.lastIndexOf(sep)); dir !== papersRoot && isUnderDir(dir, papersRoot, sep); dir = dir.slice(0, dir.lastIndexOf(sep))) {
      dirs.add(dir);
    }
  }
  return [...dirs]
    .map((dir) => ({ dir, label: formatFolderPathLabel(papersRoot, dir, sep), count: countPapersUnder(paths, dir, sep) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function listPapersInFolder(papers: readonly PaperRecord[], dir: string, sep: string): PaperRecord[] {
  return papers.filter((paper) => paper.path !== dir && isUnderDir(paper.path, dir, sep));
}

/** buildShare keeps only the shareable fields of each record, so the user's status, tags and note never leave. */
export async function createSharePaperInputs(papers: readonly PaperRecord[], withAnnotations: boolean, sources: FolderShareSources): Promise<SharePaperInput[]> {
  const inputs: SharePaperInput[] = [];
  for (const paper of papers) {
    const files = createPaperFiles(paper.path, sources.paths.join);
    const input: SharePaperInput = { metadata: paper };
    if (await sources.fs.exists(files.bib)) { input.bib = await sources.fs.readText(files.bib); }
    if (await sources.fs.exists(files.pdf)) { input.pdf = await sources.fs.readFile(files.pdf); }
    if (withAnnotations) {
      const annotations = await sources.annotations(paper.id);
      if (annotations.length > 0) { input.annotations = annotations; }
    }
    inputs.push(input);
  }
  return inputs;
}

export type ShareFolderStage = "reading" | "encrypting" | "uploading";

export interface CreateShareLinkOptions {
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

// CONTRACT: documents/contracts/share-link.md#upload-and-revoke
export async function createShareLink(options: CreateShareLinkOptions): Promise<string> {
  const { folder, withAnnotations, sources, relayUrl, onStage } = options;
  onStage?.("reading");
  const papers = listPapersInFolder(options.papers, folder, sources.paths.sep);
  const inputs = await createSharePaperInputs(papers, withAnnotations, sources);
  onStage?.("encrypting");
  const share = await buildShare({ folderName: sources.paths.basename(folder), papers: inputs, withAnnotations });
  onStage?.("uploading");
  const link = await uploadShare({ share, relayUrl, backend: options.backendFor(relayUrl), registry: options.registry, logger: options.logger });
  // The context holds no link key, so it is safe to log.
  await options.logger.log("INFO", "share", "Shared a folder as a link", { shareId: share.shareId, folder, papers: papers.length, withAnnotations, relayUrl });
  return link;
}

export const OPEN_SHARE_FAILURE: Record<OpenShareError, string> = {
  malformedLink: "LabShelf could not read that share link.",
  removed: "This link was removed by the person who shared it.",
  unreadable: "The link's key does not open this share; check that the link was copied whole.",
  network: "LabShelf could not reach the relay that serves this share.",
};

export function describeRefusedShareLink(parseError: string): string {
  return `${OPEN_SHARE_FAILURE.malformedLink} (${parseError})`;
}

export function describeSharedImport(summary: SharedImportOutcome, folderName: string, withAnnotations: boolean): string {
  const added = summary.added.length;
  const parts = [added > 0 ? `Imported ${added} of the shared papers into "${folderName}".` : "Every shared paper is already in your library."];
  if (added > 0 && summary.duplicates.length > 0) { parts.push(`${summary.duplicates.length} already in your library.`); }
  if (summary.missingPdfs.length > 0) { parts.push(`${summary.missingPdfs.length} without their PDF, which the relay could not serve.`); }
  // The sidecar store adds annotations only as new ones of the reader, so shared annotations are not copied.
  if (withAnnotations) { parts.push("Shared annotations are not imported."); }
  return parts.join(" ");
}

export interface ShareNoticeText { message: string; detail: string }

/** The notice before a share; its two choices are `SHARE_WITH_ANNOTATIONS` and `SHARE_WITHOUT_ANNOTATIONS`. */
export function describeShareRightsNotice(folder: { label: string; count: number }): ShareNoticeText {
  return {
    message: "You are responsible for having the right to share these papers.",
    detail: `Anyone with the link can read the ${folder.count} ${folder.count === 1 ? "paper" : "papers"} of "${folder.label}" and download their PDFs, until you revoke it.`,
  };
}

export const SHARE_WITH_ANNOTATIONS = "Share with my annotations";
export const SHARE_WITHOUT_ANNOTATIONS = "Share without annotations";

export function describeRevokeShareNotice(folder: string): ShareNoticeText {
  return {
    message: `Revoke the link to "${folder}"?`,
    detail: "The shared papers are deleted from your relay. Anyone who has the link can no longer open it, within about a minute.",
  };
}

export const SHARE_STAGE_TEXT: Record<ShareFolderStage, string> = { reading: "reading papers…", encrypting: "encrypting…", uploading: "uploading…" };

/** `place` is where the list of shares lives: "this device" or "this browser". */
export function describeRevokeShareOutcome(folder: string, revoked: boolean, place: string): string {
  return revoked ? `Revoked the link to "${folder}".` : `The link to "${folder}" is no longer listed on ${place}.`;
}

export function describeCopiedShareLink(folder: string): string {
  return `Copied the link to "${folder}".`;
}

export function describeShareFailure(action: string, error: unknown): string {
  return `LabShelf could not ${action}: ${formatError(error)}`;
}
