// The project side of a share mirror: labshelf.yaml follows the shared settings and comments.qmd the comment threads.
import type * as Y from "yjs";
import { deriveTextSha256Hex } from "../../hash/index.js";
import { PROJECT_FILE } from "../../writing/project/index.js";
import { COMMENTS_PATH, renderCommentsFile } from "../commentsFile.js";
import { readShareIndexDocComments, readShareIndexDocSettings, readShareIndexDocSuggestions } from "../shareIndexDoc.js";
import { deriveSharedPaths, applySharedSettings, readSettingsMap, parseSharedSettings, writeSettingsChanges, writeSettingsMap, isSafeSharePath } from "../sharedFiles.js";
import { DISK_ORIGIN, LOG_MODULE, writeMirrored, type MirrorContext, type MirrorProfile } from "./fileReconcile.js";
import type { MirrorFileRead } from "./mirrorFileSystem.js";
import type { ReconcileOutcome } from "./pathQueue.js";

async function reconcileComments(context: MirrorContext, disk: MirrorFileRead): Promise<ReconcileOutcome> {
  if (disk.state === "changing") { return "changing"; }
  const existing = disk.state === "present" ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) : undefined;
  const rendered = renderCommentsFile(context.session.index, existing);
  if (rendered === undefined) {
    await context.logger.log("WARN", LOG_MODULE, "Kept a comments.qmd that is not valid; fix or delete it to save the shared threads there", {
      folder: context.folder, path: COMMENTS_PATH,
    });
    return "done";
  }
  // An empty map writes no file into a project that has none.
  if (rendered === existing || (existing === undefined && readShareIndexDocComments(context.session.index).size === 0 && readShareIndexDocSuggestions(context.session.index).size === 0)) { return "done"; }
  await context.disk.write(COMMENTS_PATH, new TextEncoder().encode(rendered));
  await context.logger.log("INFO", LOG_MODULE, "Wrote the shared comment threads to comments.qmd", { folder: context.folder });
  return "done";
}

async function reconcileSettings(context: MirrorContext, disk: MirrorFileRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") {
    await logger.log("WARN", LOG_MODULE, "The shared project has no labshelf.yaml; settings not mirrored", { folder: context.folder });
    return "done";
  }
  const yaml = new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes);
  const diskHash = await deriveTextSha256Hex(yaml);
  const known = store.known.get(PROJECT_FILE);
  const map = readShareIndexDocSettings(session.index);
  try {
    // A first look takes the share's settings when it has any, so a fresh copy never clears them.
    if (diskHash === known || (known === undefined && map.size > 0)) {
      await writeFromShare(context, yaml, diskHash);
      return "done";
    }
    if (!settled) { context.request(PROJECT_FILE, true); return "done"; }
    const shared = parseSharedSettings(yaml);
    const base = context.settingsBase;
    // With no base (first look, or an edit made while LabShelf was closed) the file's shared keys are taken whole.
    session.index.transact(() => (base ? writeSettingsChanges(map, shared, base) : writeSettingsMap(map, shared)), DISK_ORIGIN);
    await logger.log("INFO", LOG_MODULE, "Took labshelf.yaml edits into the shared settings", { folder: context.folder, keys: Object.keys(shared) });
    await writeFromShare(context, yaml, diskHash);
  } catch (error) {
    await logger.log("WARN", LOG_MODULE, "Left labshelf.yaml out of the share until it is valid", { folder: context.folder, error: String(error) });
  }
  return "done";
}

/** Writes the index's settings into the file, keeping its own keys, and records them as the agreed base. */
async function writeFromShare(context: MirrorContext, yaml: string, diskHash: string): Promise<void> {
  const settings = readSettingsMap(readShareIndexDocSettings(context.session.index));
  const next = applySharedSettings(yaml, settings);
  if (next === yaml) { context.store.known.set(PROJECT_FILE, diskHash); } else { await writeMirrored(context, PROJECT_FILE, next); }
  context.settingsBase = settings;
}

/** A project folder: every path an export holds is shared, labshelf.yaml carries the settings and comments.qmd the threads. */
export const projectMirrorProfile: MirrorProfile = {
  // TRAP: core's root index loads this module while writing/project is part-way loaded, so the names are read on use.
  get ownFiles() { return [PROJECT_FILE, COMMENTS_PATH]; },
  get diskFiles() { return [PROJECT_FILE]; },
  sharedPaths: deriveSharedPaths,
  accepts: isSafeSharePath,
  holdsConflictCopies: true,
  reconcile: async (context, path, settled, stableMs) => path === COMMENTS_PATH
    ? reconcileComments(context, await context.disk.read(path))
    : reconcileSettings(context, await context.disk.read(path, settled ? stableMs : undefined), settled),
  observe: (index: Y.Doc, request) => {
    const settings = readShareIndexDocSettings(index);
    const onSettings = (event: Y.YMapEvent<unknown>) => { if (event.transaction.origin !== DISK_ORIGIN) { request(PROJECT_FILE); } };
    settings.observe(onSettings);
    const comments = readShareIndexDocComments(index);
    const suggestions = readShareIndexDocSuggestions(index);
    const onComments = () => request(COMMENTS_PATH);
    comments.observeDeep(onComments);
    suggestions.observeDeep(onComments);
    return () => { settings.unobserve(onSettings); comments.unobserveDeep(onComments); suggestions.unobserveDeep(onComments); };
  },
};
