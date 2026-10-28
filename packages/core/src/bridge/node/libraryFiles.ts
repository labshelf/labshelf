/** Confines bridge paths to the library root and serves the bridge's file ops on it with the LocalFileSystem port semantics. */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { errorCode } from "../../errors/index.js";
import { isDirectory } from "../../files/node/index.js";
import type { LocalStat } from "../../ports/index.js";
import { createLibraryLayout } from "../../library/index.js";
import { countPaperFolders, writeSyncedFile } from "../../library/node/index.js";
import { BridgeError } from "../bridgeError.js";
import type { BridgeResults } from "../protocol.js";

type PathApi = Pick<typeof path, "relative" | "isAbsolute" | "sep">;

const outside = (relative: string): BridgeError =>
  new BridgeError("outsideLibrary", `Path "${relative}" is outside the library`);
// The library is shared across OSes, so a name Windows cannot hold is refused everywhere.
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(?:\..*)?$/i;

/** Whether `real` is `base` or below it; win32 compares case-insensitively and across drives. */
export function isInsideBase(base: string, real: string, api: PathApi = path): boolean {
  const relative = api.relative(base, real);
  return relative === "" || (!api.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${api.sep}`));
}

/** The real path of the target, or of its nearest existing ancestor with the missing tail appended. */
async function realPathOrAncestor(target: string, relative: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  // A dangling symlink resolves nowhere, and a write through it would create its target wherever it points.
  if (await fs.lstat(target).then((s) => s.isSymbolicLink(), () => false)) throw outside(relative);
  const parent = path.dirname(target);
  return path.join(await realPathOrAncestor(parent, relative), path.basename(target));
}

async function realRootOf(root: string): Promise<string> {
  try {
    return await fs.realpath(root);
  } catch (error) {
    throw new BridgeError("noLibrary", `Library folder "${root}" is not reachable (${errorCode(error) ?? String(error)})`);
  }
}

/** The path's segments; throws outsideLibrary for any shape that could leave the root. */
function segmentsOf(relative: string): string[] {
  if (relative.includes("\0") || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
    throw outside(relative);
  }
  const segments = relative.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === ".." || WINDOWS_DEVICE_NAME.test(segment))) throw outside(relative);
  return segments;
}

/** Throws outsideLibrary unless the real path of `dir` (or of its nearest existing ancestor) is under `realRoot`. */
export async function assertInLibrary(realRoot: string, dir: string): Promise<void> {
  if (!isInsideBase(realRoot, await realPathOrAncestor(dir, dir))) throw outside(dir);
}

// CONTRACT: documents/contracts/bridge.md#paths
/** @returns the absolute path under the real library root; throws outsideLibrary or noLibrary */
export async function resolveInLibrary(root: string, relative: string): Promise<string> {
  const segments = segmentsOf(relative);
  const base = await realRootOf(root);
  const target = path.join(base, ...segments);
  if (!isInsideBase(base, await realPathOrAncestor(target, relative))) throw outside(relative);
  return target;
}

export interface LibraryParent {
  realRoot: string;
  /** Real path of the entry's folder, which may not exist yet. */
  realParent: string;
  /** The entry's own name; `""` for the root itself. */
  name: string;
}

// CONTRACT: documents/contracts/bridge.md#paths
/** Confines the entry's folder, not the entry, so a symlink entry can be inspected or removed itself. */
export async function resolveParentInLibrary(root: string, relative: string): Promise<LibraryParent> {
  const segments = segmentsOf(relative);
  const realRoot = await realRootOf(root);
  const name = segments.pop();
  if (name === undefined) return { realRoot, realParent: realRoot, name: "" };
  const realParent = await realPathOrAncestor(path.join(realRoot, ...segments), relative);
  if (!isInsideBase(realRoot, realParent)) throw outside(relative);
  return { realRoot, realParent, name };
}

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";
const entryPath = ({ realParent, name }: LibraryParent): string => path.join(realParent, name);

// CONTRACT: documents/contracts/bridge.md#paths
/** File ops on one library root; every path is relative to it and confined to it. */
export class LibraryFileOperations {
  constructor(readonly root: string) {}

  /** @throws BridgeError `noLibrary` when `root` is not an existing folder */
  static async open(root: string): Promise<LibraryFileOperations> {
    if (!path.isAbsolute(root)) throw new BridgeError("protocol", `The library folder must be an absolute path: ${root}`);
    const isFolder = await isDirectory(root);
    if (!isFolder) throw new BridgeError("noLibrary", `The library folder ${root} does not exist or is not a folder`);
    return new LibraryFileOperations(root);
  }

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
    const tmpDir = await resolveInLibrary(this.root, createLibraryLayout("", path.posix.join).tmpDir());
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

  /** Paper folders at any depth under papers/: a folder holding a metadata file is a paper and is not descended into. */
  async paperCount(): Promise<number> {
    return countPaperFolders(path.join(this.root, "papers"));
  }
}
