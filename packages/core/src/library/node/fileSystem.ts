/** Reads and writes the library's files on disk: atomic writes, owner-only folders, optional reads, and the Node
 * implementation of the library, sync and BibTeX file-system ports (its writes are atomic through the library's temp folder). */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LibraryFileSystem, LocalStat } from "../../ports/index.js";

/**
 * Writes a file atomically: temp file in tmpDir (same volume as the library), then rename over the target.
 * `mode` is the new file's permission bits (POSIX).
 */
export async function writeFileAtomic(target: string, content: string | Uint8Array, tmpDir?: string, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const dir = tmpDir ?? path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeSyncedFile(tmp, content, mode);
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    // A temp dir on another volume (rename EXDEV) falls back to a direct write.
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      await fs.writeFile(target, content, mode === undefined ? undefined : { mode });
      return;
    }
    throw error;
  }
}

/** Writes and fsyncs a temp file, so a rename over the target never exposes an empty file after a crash. */
export async function writeSyncedFile(file: string, content: string | Uint8Array, mode?: number): Promise<void> {
  const handle = await fs.open(file, "w", mode);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Mode of a folder only its owner can use. */
export const PRIVATE_DIR_MODE = 0o700;
/** Mode of a file only its owner can read. */
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Creates the folder and its missing parents, then sets the folder itself to 0o700 even when it already existed.
 * PLATFORM: Windows has no POSIX modes; callers skip this there.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await fs.chmod(dir, PRIVATE_DIR_MODE);
}

export function isGroupOrOtherWritable(mode: number): boolean {
  return (mode & 0o022) !== 0;
}

export async function readOptionalFile(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}

export class NodeLibraryFileSystem implements LibraryFileSystem {
  /**
   * @param tmpDir the library's temp folder, so atomic writes rename within one volume
   * @param moveToTrash the platform trash (the terminal's `trash` package); callers that never trash leave it out
   */
  constructor(
    private readonly tmpDir?: string,
    private readonly moveToTrash?: (target: string) => Promise<unknown>,
  ) {}

  async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  async mkdir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  async writeText(file: string, content: string): Promise<void> {
    await writeFileAtomic(file, content, this.tmpDir);
  }

  async readText(file: string): Promise<string> {
    return fs.readFile(file, "utf8");
  }

  async writeFile(file: string, content: Uint8Array): Promise<void> {
    await writeFileAtomic(file, content, this.tmpDir);
  }

  async readFile(file: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(file));
  }

  async deleteFile(file: string): Promise<void> {
    await fs.rm(file, { force: true });
  }

  async exists(target: string): Promise<boolean> {
    return fs.stat(target).then(() => true, () => false);
  }

  // lstat, like VS Code's FileType check: a symlink is neither a file nor a folder to the sync. Following it here
  // while VS Code skips it would make each app undo the other's upload or deletion on every run.
  async stat(target: string): Promise<LocalStat | undefined> {
    try {
      const s = await fs.lstat(target);
      return { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return undefined;
    }
  }

  // Only a missing folder lists as empty: an import walk must be able to report a folder it may not read. No name
  // filter: the sync must see exactly the tree VS Code's adapter sees, since both share one manifest (temp files of
  // atomic writes live in .research/tmp/, outside the synced roots).
  async listDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; }
      throw error;
    }
  }

  // TRAP: node has no no-replace rename, so this checks first (racy, like VS Code's overwrite:false). A target that is
  // the source itself is a case-only rename on a case-insensitive disk and goes through.
  async rename(from: string, to: string): Promise<void> {
    const target = await fs.lstat(to).catch(() => undefined);
    if (target) {
      const source = await fs.lstat(from);
      if (source.ino !== target.ino || source.dev !== target.dev) {
        throw Object.assign(new Error(`Cannot rename "${from}": "${to}" already exists`), { code: "EEXIST" });
      }
    }
    await fs.rename(from, to);
  }

  async removeTree(target: string): Promise<void> {
    await fs.rm(target, { recursive: true, force: true });
  }

  async trash(target: string): Promise<void> {
    if (!this.moveToTrash) { throw new Error(`Cannot trash "${target}": this file system has no trash`); }
    await this.moveToTrash(target);
  }
}
