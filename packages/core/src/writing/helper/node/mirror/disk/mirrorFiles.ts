// Reads, atomically writes and removes mirror files, and lists what the mirror holds.
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, rename, rm, rmdir, stat, unlink, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";

export interface DiskFile { size: number; mtimeMs: number }
export interface MirrorListing { files: Map<string, DiskFile>; strays: string[] }

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Lists regular files by project path; symlinks and special entries are returned as `strays` and never followed. */
export async function listMirror(srcDir: string, prefix = ""): Promise<MirrorListing> {
  const listing: MirrorListing = { files: new Map(), strays: [] };
  for (const entry of await readdir(path.join(srcDir, prefix), { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory())) {
      listing.strays.push(rel);
    } else if (entry.isDirectory()) {
      const inner = await listMirror(srcDir, rel);
      for (const [key, value] of inner.files) { listing.files.set(key, value); }
      listing.strays.push(...inner.strays);
    } else {
      const { size, mtimeMs } = await stat(path.join(srcDir, rel));
      listing.files.set(rel, { size, mtimeMs });
    }
  }
  return listing;
}

/** Writes through a temp file in `tmpDir` and renames it into place, so a reader never sees half a file. */
export async function writeAtomically(target: string, bytes: Uint8Array, tmpDir: string): Promise<DiskFile> {
  await mkdir(tmpDir, { recursive: true });
  const temp = path.join(tmpDir, randomUUID());
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  const { size, mtimeMs } = await stat(target);
  return { size, mtimeMs };
}

export async function hashFile(target: string): Promise<string> {
  return sha256Hex(await readFile(target));
}

/** Unlinks `target`, then removes each parent folder that is now empty, stopping before `srcDir`. */
export async function removeWithEmptyParents(srcDir: string, target: string): Promise<void> {
  await unlink(target);
  for (let dir = path.dirname(target); dir !== srcDir && dir.startsWith(srcDir + path.sep); dir = path.dirname(dir)) {
    try {
      await rmdir(dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST") { return; }
      throw error;
    }
  }
}
