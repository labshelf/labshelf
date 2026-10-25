/**
 * Does the folder work the UI asks for after its prompt: create, rename and delete through the core library mutations, then a
 * fresh snapshot and navigation that follows the change.
 */
import { deriveBaseName, isUnderDir, deriveParentDir } from "@labshelf/core";
import type { HostContext } from "../hostContext";

export async function createFolder(ctx: HostContext, parent: string, name: string): Promise<void> {
  const target = await ctx.mutations.createFolder(parent, name);
  await ctx.snapshots.refresh();
  ctx.endpoint.post({ type: "navigate", folder: target });
}

export async function renameFolder(ctx: HostContext, oldPath: string, name: string): Promise<void> {
  const newPath = await ctx.mutations.renameFolder(oldPath, name);
  await ctx.snapshots.refresh();
  if (isUnderDir(ctx.folder, oldPath, "/")) ctx.endpoint.post({ type: "navigate", folder: newPath + ctx.folder.slice(oldPath.length) });
}

export async function removeFolder(ctx: HostContext, path: string): Promise<void> {
  await ctx.mutations.trashFolder(path);
  await ctx.snapshots.refresh();
  if (isUnderDir(ctx.folder, path, "/")) ctx.endpoint.post({ type: "navigate", folder: deriveParentDir(path, "/") });
  ctx.notice("ok", `Deleted ${deriveBaseName(path, "/")}`);
}
