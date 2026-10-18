// Brings a project's mirror in line with a sync: removes files the page dropped and requests the ones it lacks.
import * as path from "node:path";

import type { SyncedFile, ToHelperMessage } from "../../index.js";

import {
  createSourceDir, hashFile, listMirror, loadIndex, removeWithEmptyParents, saveIndex,
  type MirrorIndex, type MirrorListing,
} from "./disk/index.js";
import type { HelperSend } from "../dispatch/index.js";
import { MIRROR_MODULE, type MirrorContext, type PendingFile } from "./mirrorTypes.js";
import { requireProjectId, requireSyncFiles } from "./mirrorValidate.js";

async function dropUnlisted(ctx: MirrorContext, srcDir: string, projectId: string, listing: MirrorListing, wanted: Set<string>): Promise<void> {
  for (const stray of listing.strays) {
    await ctx.logger.log("WARN", MIRROR_MODULE, "Removed a symlink or special entry from the mirror", { projectId, path: stray });
    await removeWithEmptyParents(srcDir, path.join(srcDir, ...stray.split("/")));
  }
  const extra = [...listing.files.keys()].filter((file) => !wanted.has(file));
  for (const file of extra) {
    listing.files.delete(file);
    await removeWithEmptyParents(srcDir, path.join(srcDir, ...file.split("/")));
  }
  if (extra.length > 0) { await ctx.logger.log("INFO", MIRROR_MODULE, "Removed mirror files the page no longer has", { projectId, count: extra.length }); }
}

async function hashOf(srcDir: string, file: string, listing: MirrorListing, old: MirrorIndex): Promise<string> {
  const disk = listing.files.get(file);
  const known = old.get(file);
  if (known !== undefined && disk !== undefined && known.size === disk.size && known.mtimeMs === disk.mtimeMs) { return known.sha256; }
  return hashFile(path.join(srcDir, ...file.split("/")));
}

export async function handleSync(ctx: MirrorContext, message: Extract<ToHelperMessage, { type: "sync" }>, send: HelperSend): Promise<void> {
  const { projectId, files } = message;
  requireProjectId(projectId);
  requireSyncFiles(files);
  const srcDir = await createSourceDir(ctx.projectsRoot, projectId);
  const projectDir = path.dirname(srcDir);
  const listing = await listMirror(srcDir);
  await dropUnlisted(ctx, srcDir, projectId, listing, new Set(files.map((file) => file.path)));
  const old = await loadIndex(projectDir, ctx.logger);
  const next: MirrorIndex = new Map();
  const needed = new Map<string, PendingFile>();
  for (const file of files as SyncedFile[]) {
    const disk = listing.files.get(file.path);
    const sha256 = disk === undefined ? undefined : await hashOf(srcDir, file.path, listing, old);
    if (disk !== undefined && sha256 === file.sha256 && disk.size === file.size) {
      next.set(file.path, { sha256, size: disk.size, mtimeMs: disk.mtimeMs });
    } else {
      needed.set(file.path, { sha256: file.sha256, size: file.size });
    }
  }
  await saveIndex(projectDir, next);
  ctx.pending.set(projectId, needed);
  send({ v: 1, id: message.id, type: "need", paths: [...needed.keys()] });
}
