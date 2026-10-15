/**
 * Does the folder work the UI asks for after its prompt: create, rename and delete through the core library mutations, then a
 * fresh snapshot, navigation that follows the change, and a sync soon.
 */
import { baseName, isUnderDir, parentDir } from "@labshelf/core";
import type { HostContext } from "../hostContext";
import { scheduleSyncSoon } from "../runtimeRequests";

export async function createFolder(ctx: HostContext, parent: string, name: string): Promise<void> {
  const target = await ctx.mutations.createFolder(parent, name);
  await ctx.snapshots.refresh();
  ctx.endpoint.post({ type: "navigate", folder: target });
  scheduleSyncSoon(ctx.log, "folder.new");
}

export async function renameFolder(ctx: HostContext, oldPath: string, name: string): Promise<void> {
  const newPath = await ctx.mutations.renameFolder(oldPath, name);
  await ctx.snapshots.refresh();
  if (isUnderDir(ctx.folder, oldPath, "/")) ctx.endpoint.post({ type: "navigate", folder: newPath + ctx.folder.slice(oldPath.length) });
  scheduleSyncSoon(ctx.log, "folder.rename");
}

export async function deleteFolder(ctx: HostContext, path: string): Promise<void> {
  await ctx.mutations.trashFolder(path);
  await ctx.snapshots.refresh();
  if (isUnderDir(ctx.folder, path, "/")) ctx.endpoint.post({ type: "navigate", folder: parentDir(path, "/") });
  scheduleSyncSoon(ctx.log, "folder.delete");
  ctx.notice("ok", `Deleted ${baseName(path, "/")}`);
}
