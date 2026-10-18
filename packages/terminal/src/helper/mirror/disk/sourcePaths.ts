// Resolves a project path to a file inside the mirror's src folder, refusing any symlink on the way.
// CONTRACT: documents/contracts/helper.md#paths
import { lstat, mkdir, realpath } from "node:fs/promises";
import * as path from "node:path";

import { MirrorRejection } from "../mirrorTypes.js";

async function lstatOrUndefined(target: string): Promise<import("node:fs").Stats | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}

/**
 * The source folder of `projectId`, created when `create` is set; undefined when it is absent and not created.
 * INVARIANT: the returned folder is a real directory whose realpath is `<realpath(projectsRoot)>/<id>/src`.
 */
export async function openSourceDir(projectsRoot: string, projectId: string, create: boolean): Promise<string | undefined> {
  const projectDir = path.join(projectsRoot, projectId);
  const srcDir = path.join(projectDir, "src");
  // A symlinked project folder must be refused before mkdir follows it and creates src outside the data folder.
  if ((await lstatOrUndefined(projectDir))?.isSymbolicLink()) {
    throw new MirrorRejection("path", "project folder is a symlink", { projectId });
  }
  if (create) { await mkdir(srcDir, { recursive: true }); }
  const stats = await lstatOrUndefined(srcDir);
  if (stats === undefined) { return undefined; }
  const expected = path.join(await realpath(projectsRoot), projectId, "src");
  if (stats.isSymbolicLink() || !stats.isDirectory() || (await realpath(srcDir)) !== expected) {
    throw new MirrorRejection("path", "project folder is not a plain directory inside the data folder", { projectId });
  }
  return srcDir;
}

/** The source folder of `projectId`, created when absent. */
export async function createSourceDir(projectsRoot: string, projectId: string): Promise<string> {
  return (await openSourceDir(projectsRoot, projectId, true)) as string;
}

/**
 * The absolute target of `relPath` under `srcDir`, or undefined when a folder on the way is absent and `create` is unset.
 * Missing folders are created one at a time when `create` is set. A symlink anywhere on the path, or a file where a
 * folder is needed, rejects with `path`.
 */
export async function resolveInSource(srcDir: string, relPath: string, create: boolean): Promise<string | undefined> {
  const segments = relPath.split("/");
  const reject = (reason: string) => new MirrorRejection("path", reason, { path: relPath });
  let current = srcDir;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const stats = await lstatOrUndefined(current);
    if (stats === undefined) {
      if (!create) { return undefined; }
      await mkdir(current);
    } else if (stats.isSymbolicLink()) {
      throw reject("a folder on the path is a symlink");
    } else if (!stats.isDirectory()) {
      throw reject("a file sits where a folder is needed");
    }
  }
  const target = path.join(current, segments.at(-1) as string);
  const stats = await lstatOrUndefined(target);
  if (stats?.isSymbolicLink()) { throw reject("the file is a symlink"); }
  if (stats !== undefined && !stats.isFile()) { throw reject("the target is not a regular file"); }
  const realParent = await realpath(current);
  const realSrc = await realpath(srcDir);
  if (realParent !== realSrc && !realParent.startsWith(realSrc + path.sep)) { throw reject("the path leaves the source folder"); }
  return target;
}
