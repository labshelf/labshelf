/** Implements the library, sync and BibTeX file-system ports over node:fs; writes are atomic through the library's temp folder. */
import { promises as fs } from "node:fs";

import type { LibraryFileSystem, LocalStat } from "../../ports/index.js";
import { writeFileAtomic } from "./atomicWrite.js";

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
