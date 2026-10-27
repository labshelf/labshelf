// Provides the state for mirroring shared project files.
import type { ConflictCopy } from "../../library/conflicts/index.js";
import type { WriteRecordStore } from "../../library/mutations/index.js";
import type { WaitingWrite } from "./waitForWrite.js";
import { deriveTextSha256Hex } from "../../hash/index.js";
import type { ILogger } from "../../ports/index.js";
import { readShareIndexDocFiles, addWrittenVersion, type SharedSettings } from "../model/index.js";
import type { ShareBlobExchange, ShareSession } from "../doc/index.js";
import type { CollabStore } from "../deviceState/index.js";
import type { MirrorFileSystem } from "./fileSystem/index.js";

export const LOG_MODULE = "collab.mirror";
/** The transaction origin of every edit the mirror makes to the share from disk. */
export const DISK_ORIGIN = "disk";

/** Merges two edited texts against their base line by line, marking overlaps; injected because the merge library is Node-only. */
export type MergeText = (input: { base: string; local: string; other: string; otherLabel: string }) => { text: string; conflicted: boolean };

export interface MirrorContext {
  /** Names the project in logs. */
  folder: string;
  disk: MirrorFileSystem;
  writeRecords: WriteRecordStore;
  waitingWrites: Map<string, WaitingWrite>;
  mergeText: MergeText;
  session: ShareSession;
  blobs: ShareBlobExchange;
  store: CollabStore;
  logger: ILogger;
  conflictReports?: Map<string, string>;
  onConflictCopy?(copy: ConflictCopy): void | Promise<void>;
  readConflictDismissals?(): Promise<readonly { path: string; hash: string }[]>;
  /** The shared settings labshelf.yaml and the index last agreed on during this run; undefined until they first do. */
  settingsBase: SharedSettings | undefined;
  /** Blob paths whose fetch failed, retried when a peer joins. */
  missingBlobs: Set<string>;
  /** Reconciles the path again; `settle` waits until the file stops changing. */
  request(path: string, settle: boolean): void;
  /** Listens to a text doc's edits from now on. */
  attach(path: string): void;
}

/** Writes the file atomically and records its content as the one disk and doc agree on. */
export async function writeMirrored(context: MirrorContext, relative: string, content: string | Uint8Array): Promise<void> {
  const hash = await deriveTextSha256Hex(content);
  await context.writeRecords.append({ path: relative, hash, parent: context.store.known.get(relative) ?? null, by: "mirror", at: Date.now() });
  await context.disk.write(relative, typeof content === "string" ? new TextEncoder().encode(content) : content);
  addMirroredPath(context, relative, content, hash);
  await context.logger.log("INFO", LOG_MODULE, "Wrote a shared file from the share", { folder: context.folder, path: relative, length: content.length });
}

export async function removeMirroredFile(context: MirrorContext, relative: string): Promise<void> {
  await context.disk.remove(relative);
  removeMirroredPath(context, relative);
  await context.logger.log("INFO", LOG_MODULE, "Deleted a file the share removed", { folder: context.folder, path: relative });
}

export function removeMirroredPath(context: MirrorContext, relative: string): void {
  context.waitingWrites.delete(relative);
  context.store.known.delete(relative);
  context.store.bases.delete(relative);
}

export function addMirroredPath(context: MirrorContext, path: string, content: string | Uint8Array, hash: string): void {
  context.waitingWrites.delete(path);
  context.store.known.set(path, hash);
  if (!readShareIndexDocFiles(context.session.index).has(path)) { return; }
  addWrittenVersion(context.session.index, path, hash, Date.now());
  if (typeof content === "string") {
    context.store.rememberVersion(path, hash, content);
    context.store.bases.set(path, content);
  }
}
