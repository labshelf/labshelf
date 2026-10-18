/** Serves the bridge's file ops on the library folder with the LocalFileSystem port semantics. */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LocalStat } from "../../ports/index.js";
import { libraryLayout, METADATA_FILE } from "../../library/index.js";
import { writeSyncedFile } from "../../library/node/index.js";
import { BridgeError } from "../bridgeError.js";
import type { BridgeResults } from "../protocol.js";
import { assertInLibrary, resolveInLibrary, resolveParentInLibrary, type LibraryParent } from "./pathConfinement.js";

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";
const entryPath = ({ realParent, name }: LibraryParent): string => path.join(realParent, name);

// CONTRACT: documents/contracts/bridge.md#paths
/** File ops on one library root; every path is relative to it and confined to it. */
export class LibraryFileOperations {
  constructor(readonly root: string) {}

  resolve(relative: string): Promise<string> {
    return resolveInLibrary(this.root, relative);
  }

  /** Confines the entry's folder and refuses the root, which no op may replace or remove. */
  private async parentOf(relative: string): Promise<LibraryParent> {
    const parent = await resolveParentInLibrary(this.root, relative);
    if (parent.name === "") throw new BridgeError("outsideLibrary", "The library root itself cannot be changed");
    return parent;
  }

  // readdir does not follow symlink entries, so they are listed as names like any other entry.
  async listDir(relative: string): Promise<BridgeResults["listDir"]> {
    const dir = await this.resolve(relative);
    try {
      return { names: await fs.readdir(dir) };
    } catch (error) {
      if (missing(error)) return { names: [] };
      throw error;
    }
  }

  // lstat, as NodeLibraryFileSystem does: a symlink is neither a file nor a folder to the sync.
  async stat(relative: string): Promise<BridgeResults["stat"]> {
    const target = entryPath(await resolveParentInLibrary(this.root, relative));
    try {
      const s = await fs.lstat(target);
      const stat: LocalStat = { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size };
      return { stat };
    } catch (error) {
      if (missing(error)) return { stat: null };
      throw error;
    }
  }

  async readFile(relative: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(await this.resolve(relative)));
  }

  // CONTRACT: documents/contracts/bridge.md#file-transfer
  /** Writes through a temp file in the library's scratch folder, so the sync tool never uploads half a file. */
  async writeFile(relative: string, content: Uint8Array): Promise<void> {
    await this.resolve(relative);
    const parent = await this.parentOf(relative);
    const tmpDir = await resolveInLibrary(this.root, libraryLayout("", path.posix.join).tmpDir());
    await fs.mkdir(tmpDir, { recursive: true });
    await assertInLibrary(parent.realRoot, tmpDir);
    await fs.mkdir(parent.realParent, { recursive: true });
    const tmp = path.join(tmpDir, `.${parent.name}.${randomUUID()}.tmp`);
    try {
      await writeSyncedFile(tmp, content);
      await assertInLibrary(parent.realRoot, parent.realParent);
      await fs.rename(tmp, entryPath(parent));
    } catch (error) {
      await fs.rm(tmp, { force: true });
      // A non-atomic copy could be uploaded half-written by the sync tool, so a cross-volume scratch folder is an error.
      if ((error as NodeJS.ErrnoException).code === "EXDEV") {
        throw new BridgeError("io", `Cannot write "${relative}" atomically: ${tmpDir} is on another volume than the library`);
      }
      throw error;
    }
  }

  // rm acts on the entry itself, so a symlink is removed and its target is left alone.
  async deleteFile(relative: string): Promise<void> {
    const parent = await this.parentOf(relative);
    await assertInLibrary(parent.realRoot, parent.realParent);
    await fs.rm(entryPath(parent), { force: true });
  }

  // rm does not follow a symlink entry or the links inside the tree, so no target outside the folder is touched.
  async deleteDir(relative: string): Promise<void> {
    const parent = await this.parentOf(relative);
    const target = entryPath(parent);
    const entry = await fs.lstat(target).catch((error: unknown) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (!entry) return;
    if (entry.isFile()) throw new BridgeError("io", `Cannot delete "${relative}" as a folder: it is a file`);
    await assertInLibrary(parent.realRoot, parent.realParent);
    await fs.rm(target, { recursive: true, force: true });
  }

  async ensureDir(relative: string): Promise<void> {
    await fs.mkdir(await this.resolve(relative), { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    const source = await this.parentOf(from);
    const target = await this.parentOf(to);
    await fs.lstat(entryPath(source));
    await fs.mkdir(target.realParent, { recursive: true });
    await assertInLibrary(source.realRoot, source.realParent);
    await assertInLibrary(target.realRoot, target.realParent);
    await fs.rename(entryPath(source), entryPath(target));
  }

  /** Paper folders under papers/ that hold a metadata file. */
  async paperCount(): Promise<number> {
    const { names } = await this.listDir("papers");
    const counted = await Promise.all(
      names.map((name) => fs.stat(path.join(this.root, "papers", name, METADATA_FILE)).then((s) => s.isFile(), () => false)),
    );
    return counted.filter(Boolean).length;
  }
}
