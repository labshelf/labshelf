// Provides the mirror's shared state and reconciles one binary or unlisted file between the share and the disk.
import type { ConflictCopy } from "../../library/conflicts/index.js";
import { recordFor, type WriteRecordStore } from "../../library/index.js";
import { deriveTextSha256Hex } from "../../hash/index.js";
import type { ILogger } from "../../ports/index.js";
import { detectProjectConflict, isEligibleProjectConflictPath } from "../../writing/conflict/index.js";
import { parseProjectFile, PROJECT_FILE } from "../../writing/project/index.js";
import {
  addWrittenVersion,
  deriveSharedFileKind,
  deriveSharedPaths,
  readShareIndexDocFiles,
  readWrittenHashes,
  setFileText,
  type ShareBlobExchange,
  type ShareFileEntry,
  type ShareSession,
  type SharedSettings,
} from "../doc/index.js";
import type { CollabStore } from "../deviceState/index.js";
import type { MirrorFileRead, MirrorFileSystem } from "./mirrorFileSystem.js";
import type { ReconcileOutcome } from "./pathQueue.js";

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

export interface WaitingWrite { hash: string; mirror: boolean; answered: boolean; canceled?: boolean }

export async function checkWaitingWrite(context: MirrorContext, path: string, hash: string): Promise<{ waiting: boolean; parent?: string | undefined }> {
  if (readWrittenHashes(context.session.index, path).has(hash)) { context.waitingWrites.delete(path); return { waiting: false }; }
  const records = await context.writeRecords.read();
  const record = recordFor(records, path, hash);
  const mirror = record?.by === "mirror";
  const parent = record?.parent ?? undefined;
  const previous = context.waitingWrites.get(path);
  if (previous?.hash === hash && previous.mirror === mirror && !previous.canceled) { return { waiting: mirror || !previous.answered, parent }; }
  const waiting: WaitingWrite = { hash, mirror, answered: false };
  context.waitingWrites.set(path, waiting);
  if (mirror) {
    await context.logger.log("INFO", LOG_MODULE, "Waiting for an in-flight mirror write", { folder: context.folder, path, hash });
  } else {
    const roundTrip = context.session.indexRoundTrip();
    if (!roundTrip) { context.waitingWrites.delete(path); return { waiting: false, parent }; }
    void roundTrip.then((answered) => {
      if (!answered) { waiting.canceled = true; return; }
      if (context.waitingWrites.get(path) !== waiting) { return; }
      waiting.answered = true;
      context.request(path, true);
    }).catch((error: unknown) => {
      waiting.canceled = true;
      return context.logger.error(LOG_MODULE, error, { folder: context.folder, path, action: "index round trip" });
    });
  }
  return { waiting: true, parent };
}

export async function reconcileShareBlob(
  context: MirrorContext, path: string, entry: ShareFileEntry, disk: MirrorFileRead, settled: boolean,
): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  const known = store.known.get(path);
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "present") {
    const diskHash = await deriveTextSha256Hex(disk.bytes);
    if (diskHash === entry.hash) { await store.blobs.put(disk.bytes); addMirroredPath(context, path, disk.bytes, diskHash); return "done"; }
    if (diskHash !== known) {
      if (!settled) { context.request(path, true); return "done"; }
      if (readWrittenHashes(session.index, path).has(diskHash)) {
        await writeFetched(context, path, entry);
        return "done";
      }
      if ((await checkWaitingWrite(context, path, diskHash)).waiting) { return "done"; }
      if (readShareIndexDocFiles(session.index).get(path) !== entry || readWrittenHashes(session.index, path).has(diskHash)) { context.request(path, false); return "done"; }
      await store.blobs.put(disk.bytes);
      if (readShareIndexDocFiles(session.index).get(path) !== entry || readWrittenHashes(session.index, path).has(diskHash)) { context.request(path, false); return "done"; }
      session.index.transact(() => readShareIndexDocFiles(session.index).set(path, { kind: "blob", hash: diskHash }), DISK_ORIGIN);
      addMirroredPath(context, path, disk.bytes, diskHash);
      await logger.log("INFO", LOG_MODULE, "Took an outside change of a binary file into the share", { folder: context.folder, path, hash: diskHash });
      return "done";
    }
  } else if (known !== undefined) {
    if (!settled) { context.request(path, true); return "done"; }
    session.index.transact(() => readShareIndexDocFiles(session.index).delete(path), DISK_ORIGIN);
    removeMirroredPath(context, path);
    await logger.log("INFO", LOG_MODULE, "Removed a file deleted on disk from the share", { folder: context.folder, path });
    return "done";
  }
  await writeFetched(context, path, entry);
  return "done";
}

async function writeFetched(context: MirrorContext, path: string, entry: ShareFileEntry): Promise<void> {
  const { session, store, logger } = context;
  const hash = entry.hash;
  if (hash === undefined) { return void await logger.log("WARN", LOG_MODULE, "Skipped a binary file listed without a hash", { path }); }
  const bytes = await store.blobs.get(hash) ?? await fetched(context, path, hash);
  if (!bytes) { return; }
  if (await deriveTextSha256Hex(bytes) !== hash) { return void await logger.log("WARN", LOG_MODULE, "Refused a blob whose bytes do not match its hash", { path, hash }); }
  await store.blobs.put(bytes);
  // TRAP: The entry may have moved on while the blob travelled.
  if (readShareIndexDocFiles(session.index).get(path)?.hash !== hash) { return context.request(path, false); }
  context.missingBlobs.delete(path);
  await writeMirrored(context, path, bytes);
}

async function fetched(context: MirrorContext, path: string, hash: string): Promise<Uint8Array | undefined> {
  try {
    return await context.blobs.fetch(hash);
  } catch (error) {
    context.missingBlobs.add(path);
    await context.logger.log("WARN", LOG_MODULE, "Could not fetch a blob; retrying when a peer joins", { path, hash, error: String(error) });
    return undefined;
  }
}

export async function reconcileUntracked(context: MirrorContext, path: string, disk: MirrorFileRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") { removeMirroredPath(context, path); return "done"; }
  const diskHash = await deriveTextSha256Hex(disk.bytes);
  const known = store.known.get(path);
  // The share removed a file this device still holds as last synced, so the removal applies here too.
  if (known === diskHash) { await removeMirroredFile(context, path); return "done"; }
  if (deriveSharedPaths([path]).length === 0) { return "done"; }
  if (!settled) { context.request(path, true); return "done"; }
  if ((await checkWaitingWrite(context, path, diskHash)).waiting) { return "done"; }
  if (readShareIndexDocFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  if (await holdConflictCopy(context, path, disk.bytes, diskHash)) { return "done"; }
  if (readShareIndexDocFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  const kind = deriveSharedFileKind(path, disk.bytes);
  const content = kind === "text" ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) : disk.bytes;
  let entry: ShareFileEntry = { kind };
  if (typeof content === "string") {
    setFileText(session.openDoc(path), content, DISK_ORIGIN);
  } else {
    entry = { kind, hash: await store.blobs.put(disk.bytes) };
  }
  if (readShareIndexDocFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  session.index.transact(() => readShareIndexDocFiles(session.index).set(path, entry), DISK_ORIGIN);
  addMirroredPath(context, path, content, diskHash);
  context.attach(path);
  if (known !== undefined) {
    await logger.log("WARN", LOG_MODULE, "Shared again a file the share removed but this device changed", { folder: context.folder, path });
  }
  await logger.log("INFO", LOG_MODULE, "Added a new file on disk to the share", { folder: context.folder, path, kind });
  return "done";
}

function absolutePath(folder: string, relative: string): string {
  const separator = folder.includes("\\") ? "\\" : "/";
  return `${folder.replace(/[\\/]$/, "")}${separator}${relative.split("/").join(separator)}`;
}

async function holdConflictCopy(context: MirrorContext, path: string, bytes: Uint8Array, hash: string): Promise<boolean> {
  if (!isEligibleProjectConflictPath(path) || deriveSharedFileKind(path, bytes) !== "text") { return false; }
  const records = await context.writeRecords.read();
  const listed = readShareIndexDocFiles(context.session.index);
  const candidates = deriveSharedPaths(await context.disk.list()).filter(sibling => sibling !== path && isEligibleProjectConflictPath(sibling));
  // INVARIANT: A deterministic original prevents two untracked files from holding each other on the first scan.
  const preferred = candidates.filter(sibling => listed.has(sibling) || records.has(sibling) ||
    (!records.has(path) && (sibling.length < path.length || (sibling.length === path.length && sibling < path))));
  const siblings = [];
  for (const sibling of preferred) {
    const disk = await context.disk.read(sibling);
    if (disk.state === "present" && deriveSharedFileKind(sibling, disk.bytes) === "text") {
      siblings.push({ path: sibling, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) });
    }
  }
  const dismissed = (await context.readConflictDismissals?.() ?? []).map(entry => ({
    path: entry.path === absolutePath(context.folder, path) ? path : entry.path, hash: entry.hash,
  }));
  const conflict = await detectProjectConflict({ projectId: context.folder.split(/[\\/]/).pop() ?? context.folder,
    path, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), siblings, records, dismissed });
  const current = await context.disk.read(path);
  if (current.state !== "present" || await deriveTextSha256Hex(current.bytes) !== hash) { context.request(path, true); return true; }
  if (!conflict) { context.conflictReports?.delete(path); return false; }
  if (context.conflictReports?.get(path) !== hash) {
    await context.logger.log("INFO", LOG_MODULE, "Held a conflict copy out of the share", { folder: context.folder, path, original: conflict.original, match: conflict.match });
    const projectId = await localProjectId(context);
    await context.onConflictCopy?.({ ...conflict, owner: { kind: "project", id: projectId }, original: absolutePath(context.folder, conflict.original), copy: absolutePath(context.folder, conflict.copy) });
    context.conflictReports?.set(path, hash);
  }
  return true;
}


async function localProjectId(context: MirrorContext): Promise<string> {
  const settings = await context.disk.read(PROJECT_FILE);
  if (settings.state === "present") {
    const parsed = parseProjectFile(new TextDecoder().decode(settings.bytes));
    if (parsed.ok) { return parsed.settings.id; }
    await context.logger.log("WARN", LOG_MODULE, "Used the folder name for a conflict in a project with invalid settings", { folder: context.folder });
  }
  return context.folder.split(/[\\/]/).pop() ?? context.folder;
}
