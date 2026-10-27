// Moves a library folder to a new location without losing a file, and records the new root in the shared config.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { isDirectory } from "../../../files/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { formatError } from "../../../errors/index.js";
import { deriveLibraryKey, resolveDeviceStateDir } from "../deviceState/index.js";
import { resolveSharedConfigPath, updateSharedConfig } from "../sharedConfigFile.js";
import { isLibraryFolder } from "./detectLibraryFolder.js";
import { deriveSha256Hex } from "../../../hash/index.js";
import { resolveCacheDir } from "../resolveCacheDir.js";

/** A folder that cannot move stays where it is and is logged; the library move has already succeeded. */
async function moveDeviceLocalFolders(
  fromKey: string,
  toKey: string,
  env: NodeJS.ProcessEnv,
  logger: ILogger,
): Promise<void> {
  if (fromKey === toKey) { return; }
  for (const base of [resolveCacheDir(env), resolveDeviceStateDir(env)]) {
    const source = path.join(base, "libraries", fromKey);
    const target = path.join(base, "libraries", toKey);
    if (!(await isDirectory(source))) { continue; }
    try {
      await fs.rename(source, target);
    } catch (error) {
      await logger.error("libraryMove", error, { action: "move device-local folder", from: source, to: target });
    }
  }
}

interface TreeFile {
  rel: string;
  size: number;
  mtime: Date;
}

interface TreeListing {
  dirs: string[];
  files: TreeFile[];
}

async function listTree(root: string): Promise<TreeListing> {
  const listing: TreeListing = { dirs: [], files: [] };
  async function walk(rel: string): Promise<void> {
    for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        listing.dirs.push(childRel);
        await walk(childRel);
      } else if (entry.isFile()) {
        const stat = await fs.stat(path.join(root, childRel));
        listing.files.push({ rel: childRel, size: stat.size, mtime: stat.mtime });
      } else {
        throw new Error(`Cannot copy ${childRel}: only files and folders are supported`);
      }
    }
  }
  await walk("");
  return listing;
}

async function hashOf(file: string): Promise<string> {
  return deriveSha256Hex(await fs.readFile(file));
}

async function verifyCopy(listing: TreeListing, from: string, to: string): Promise<void> {
  for (const file of listing.files) {
    const copied = await fs.stat(path.join(to, file.rel)).catch(() => undefined);
    if (!copied) { throw new Error(`Copy is missing ${file.rel}`); }
    if (copied.size !== file.size) { throw new Error(`Copy of ${file.rel} has size ${copied.size}, expected ${file.size}`); }
    if ((await hashOf(path.join(from, file.rel))) !== (await hashOf(path.join(to, file.rel)))) {
      throw new Error(`Copy of ${file.rel} differs from the source`);
    }
  }
  const copiedCount = (await listTree(to)).files.length;
  if (copiedCount !== listing.files.length) { throw new Error(`Copy has ${copiedCount} files, expected ${listing.files.length}`); }
}

/**
 * Copies `from` into `to` (created), keeping modification times, then verifies every file.
 * @throws on the first difference; the caller removes the partial copy
 */
async function copyTreeVerified(
  from: string,
  to: string,
  onProgress?: (copied: number, total: number) => void,
): Promise<void> {
  const listing = await listTree(from);
  await fs.mkdir(to, { recursive: true });
  for (const dir of listing.dirs) { await fs.mkdir(path.join(to, dir), { recursive: true }); }
  let copied = 0;
  for (const file of listing.files) {
    await fs.copyFile(path.join(from, file.rel), path.join(to, file.rel));
    await fs.utimes(path.join(to, file.rel), file.mtime, file.mtime);
    onProgress?.(++copied, listing.files.length);
  }
  await verifyCopy(listing, from, to);
}

// The target may not exist yet, so resolve its nearest existing ancestor and append the rest.
async function realPathOfFuture(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
    const parent = path.dirname(target);
    if (parent === target) { return target; }
    return path.join(await realPathOfFuture(parent), path.basename(target));
  }
}

async function holdsFiles(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || (await holdsFiles(path.join(dir, entry.name)))) { return true; }
  }
  return false;
}

/**
 * @throws when the source is not a library, the target is the source or inside it, or the target holds any file
 * (an existing folder with only empty folders is allowed)
 */
async function assertMovable(from: string, to: string): Promise<void> {
  if (!(await isLibraryFolder(from))) { throw new Error(`${from} is not a library`); }
  const relative = path.relative(await fs.realpath(from), await realPathOfFuture(to));
  if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error(`The target ${to} is the library folder or inside it`);
  }
  const stat = await fs.stat(to).catch(() => undefined);
  if (stat && (!stat.isDirectory() || (await holdsFiles(to)))) {
    throw new Error(`The target ${to} is not empty`);
  }
}

export interface MoveLibraryOptions {
  logger: ILogger;
  env: NodeJS.ProcessEnv;
  /** Called after each copied file; only a move across devices copies. */
  onProgress?: ((copied: number, total: number) => void) | undefined;
}

// PLATFORM: rename fails with EXDEV between volumes, which is the only case that needs a copy.
async function renameOrCopy(source: string, target: string, options: MoveLibraryOptions): Promise<void> {
  const { logger } = options;
  try {
    await fs.rename(source, target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") { throw error; }
  }
  await logger.log("INFO", "libraryMove", "Library is on another volume, copying and verifying", { from: source, to: target });
  try {
    await copyTreeVerified(source, target, options.onProgress);
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch((cleanup) => logger.error("libraryMove", cleanup, { target }));
    throw error;
  }
  // The copy is verified, so a source that cannot be fully deleted is leftover, not lost data.
  await fs.rm(source, { recursive: true, force: true }).catch((cleanup) =>
    logger.error("libraryMove", cleanup, { action: "delete source after verified copy", source }));
}

async function relocate(source: string, target: string, options: MoveLibraryOptions): Promise<void> {
  // INVARIANT: assertMovable has shown the target holds no file, so removing it removes only empty folders.
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await renameOrCopy(source, target, options);
}

/**
 * Moves the library and its device-local folders, then points the shared config at the new root.
 * @throws before touching anything when the move is refused (see assertMovable); after a failed copy the source
 * is intact and the partial target is gone
 */
export async function moveLibrary(from: string, to: string, options: MoveLibraryOptions): Promise<void> {
  const { logger, env } = options;
  const source = path.resolve(from);
  const target = path.resolve(to);
  await logger.log("INFO", "libraryMove", "Moving library", { from: source, to: target });
  let fromKey: string;
  try {
    await assertMovable(source, target);
    fromKey = deriveLibraryKey(source);
    await relocate(source, target, options);
  } catch (error) {
    await logger.error("libraryMove", error, { action: "move library", from: source, to: target });
    throw new Error(`Could not move the library from ${source} to ${target}: ${formatError(error)}`, { cause: error });
  }
  await moveDeviceLocalFolders(fromKey, deriveLibraryKey(target), env, logger);
  await updateSharedConfig({ libraryRoot: target }, resolveSharedConfigPath(env), logger);
  await logger.log("INFO", "libraryMove", "Library moved", { from: source, to: target });
}
