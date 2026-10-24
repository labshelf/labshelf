// Copies a folder tree and proves the copy matches the source by file count, size and SHA-256 of every file.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { sha256Hex } from "../../../hash/index.js";

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
  return sha256Hex(await fs.readFile(file));
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
export async function copyTreeVerified(
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
