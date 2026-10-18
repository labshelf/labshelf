// Declares what the reconciles of one mirrored project share, and writes and deletes its files on disk.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "../../../library/node/index.js";
import { sha256Hex } from "../../../hash/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { SharedSettings } from "../../model/index.js";
import type { BlobExchange, ShareSession } from "../../sync/index.js";
import type { CollabStore } from "../state/index.js";

export const LOG_MODULE = "collab.mirror";
/** The transaction origin of every edit the mirror makes to the share from disk. */
export const DISK_ORIGIN = "disk";

export interface MirrorContext {
  folder: string;
  session: ShareSession;
  blobs: BlobExchange;
  store: CollabStore;
  logger: ILogger;
  /** Text disk and doc last had in common during this run: the base of a three-way merge when both changed. */
  bases: Map<string, string>;
  /** The shared settings labshelf.yaml and the index last agreed on during this run; undefined until they first do. */
  settingsBase: SharedSettings | undefined;
  /** Blob paths whose fetch failed, retried when a peer joins. */
  missingBlobs: Set<string>;
  /** Reconciles the path again; `settle` waits until the file stops changing. */
  request(path: string, settle: boolean): void;
  /** Listens to a text doc's edits from now on. */
  attach(path: string): void;
}

export const diskPath = (context: MirrorContext, relative: string): string => path.join(context.folder, ...relative.split("/"));

export const hashOf = (content: string | Uint8Array): Promise<string> =>
  sha256Hex(typeof content === "string" ? new TextEncoder().encode(content) : content);

/** Writes the file atomically and records its content as the one disk and doc agree on. */
export async function writeMirrored(context: MirrorContext, relative: string, content: string | Uint8Array): Promise<void> {
  await writeFileAtomic(diskPath(context, relative), content);
  context.store.known.set(relative, await hashOf(content));
  if (typeof content === "string") { context.bases.set(relative, content); }
  await context.logger.log("INFO", LOG_MODULE, "Wrote a shared file from the share", { folder: context.folder, path: relative, length: content.length });
}

export async function deleteMirrored(context: MirrorContext, relative: string): Promise<void> {
  await fs.rm(diskPath(context, relative), { force: true });
  forget(context, relative);
  await context.logger.log("INFO", LOG_MODULE, "Deleted a file the share removed", { folder: context.folder, path: relative });
}

export function forget(context: MirrorContext, relative: string): void {
  context.store.known.delete(relative);
  context.bases.delete(relative);
}
