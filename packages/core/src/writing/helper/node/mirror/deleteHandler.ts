// Removes the listed files from a project's mirror, with the folders they leave empty.
import * as path from "node:path";
import { lstat } from "node:fs/promises";

import { PROTOCOL_VERSION } from "../../index.js";
import type { ToHelperMessage } from "../../index.js";

import { loadIndex, openSourceDir, removeWithEmptyParents, resolveInSource, saveIndex } from "./disk/index.js";
import type { HelperSend } from "../dispatch/index.js";
import { MIRROR_MODULE, type MirrorContext } from "./mirrorTypes.js";
import { requirePath, requirePathCount, requireProjectId } from "./mirrorValidate.js";

export async function handleDelete(ctx: MirrorContext, message: Extract<ToHelperMessage, { type: "delete" }>, send: HelperSend): Promise<void> {
  const { projectId, paths } = message;
  requireProjectId(projectId);
  requirePathCount(paths.length, "path count");
  paths.forEach(requirePath);
  const srcDir = await openSourceDir(ctx.projectsRoot, projectId, false);
  const targets: { rel: string; abs: string }[] = [];
  for (const rel of srcDir === undefined ? [] : paths) {
    const abs = await resolveInSource(srcDir as string, rel, false);
    if (abs === undefined) { continue; }
    // resolveInSource already refused symlinks and folders, so an existing target here is a regular file.
    if (await lstat(abs).then(() => true, () => false)) { targets.push({ rel, abs }); }
  }
  if (srcDir !== undefined && targets.length > 0) {
    const projectDir = path.dirname(srcDir);
    const index = await loadIndex(projectDir, ctx.logger);
    for (const { rel, abs } of targets) {
      await removeWithEmptyParents(srcDir, abs);
      index.delete(rel);
    }
    await saveIndex(projectDir, index);
    await ctx.logger.log("INFO", MIRROR_MODULE, "Deleted mirror files", { projectId, count: targets.length });
  }
  send({ v: PROTOCOL_VERSION, id: message.id, type: "need", paths: [] });
}
