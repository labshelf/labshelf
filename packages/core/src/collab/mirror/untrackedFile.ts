// Reconciles unlisted disk files before admitting them to a project share.
import { detectProjectConflict, isEligibleProjectConflictPath } from "../../library/conflicts/index.js";
import { parseProjectFile, PROJECT_FILE } from "../../writing/project/index.js";
import { waitsForWrite } from "./waitForWrite.js";
import { indexFiles, replaceFileText, sharedFileKind, sharedPaths, type ShareFileEntry } from "../model/index.js";
import { deleteMirrored, DISK_ORIGIN, forget, hashOf, LOG_MODULE, rememberMirrored, type MirrorContext } from "./mirrorContext.js";
import type { DiskRead } from "./fileSystem/index.js";
import type { ReconcileOutcome } from "./pathQueue.js";

export async function reconcileUntracked(context: MirrorContext, path: string, disk: DiskRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") { forget(context, path); return "done"; }
  const diskHash = await hashOf(disk.bytes);
  const known = store.known.get(path);
  // The share removed a file this device still holds as last synced, so the removal applies here too.
  if (known === diskHash) { await deleteMirrored(context, path); return "done"; }
  if (sharedPaths([path]).length === 0) { return "done"; }
  if (!settled) { context.request(path, true); return "done"; }
  if ((await waitsForWrite(context, path, diskHash)).waiting) { return "done"; }
  if (indexFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  if (await holdConflictCopy(context, path, disk.bytes, diskHash)) { return "done"; }
  if (indexFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  const kind = sharedFileKind(path, disk.bytes);
  const content = kind === "text" ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) : disk.bytes;
  let entry: ShareFileEntry = { kind };
  if (typeof content === "string") {
    replaceFileText(session.openDoc(path), content, DISK_ORIGIN);
  } else {
    entry = { kind, hash: await store.blobs.put(disk.bytes) };
  }
  if (indexFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  session.index.transact(() => indexFiles(session.index).set(path, entry), DISK_ORIGIN);
  rememberMirrored(context, path, content, diskHash);
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
  if (!isEligibleProjectConflictPath(path) || sharedFileKind(path, bytes) !== "text") { return false; }
  const records = await context.writeRecords.read();
  const listed = indexFiles(context.session.index);
  const candidates = sharedPaths(await context.disk.list()).filter(sibling => sibling !== path && isEligibleProjectConflictPath(sibling));
  // INVARIANT: A deterministic original prevents two untracked files from holding each other on the first scan.
  const preferred = candidates.filter(sibling => listed.has(sibling) || records.has(sibling) ||
    (!records.has(path) && (sibling.length < path.length || (sibling.length === path.length && sibling < path))));
  const siblings = [];
  for (const sibling of preferred) {
    const disk = await context.disk.read(sibling);
    if (disk.state === "present" && sharedFileKind(sibling, disk.bytes) === "text") {
      siblings.push({ path: sibling, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) });
    }
  }
  const dismissed = (await context.readConflictDismissals?.() ?? []).map(entry => ({
    path: entry.path === absolutePath(context.folder, path) ? path : entry.path, hash: entry.hash,
  }));
  const conflict = await detectProjectConflict({ projectId: context.folder.split(/[\\/]/).pop() ?? context.folder,
    path, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), siblings, records, dismissed });
  const current = await context.disk.read(path);
  if (current.state !== "present" || await hashOf(current.bytes) !== hash) { context.request(path, true); return true; }
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
