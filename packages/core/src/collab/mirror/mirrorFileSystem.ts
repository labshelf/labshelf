// Declares the disk port the shared-project mirror reads, writes and watches its folder through, with its settled read, folder listing and library-backed adapter.
import { sleep } from "../../async/index.js";
import { sameBytes } from "../../encoding/index.js";
import { posixPathOps } from "../../path/index.js";
import type { LibraryFileSystem } from "../../ports/index.js";
import { listProjectFiles, type ProjectReadContext } from "../../writing/project/index.js";
import { SHARED_TOOL_FILES } from "../doc/index.js";

export type MirrorFileRead = { state: "missing" } | { state: "present"; bytes: Uint8Array } | { state: "changing" };

// INVARIANT: every path is POSIX and relative to the project folder; the adapter resolves it inside the folder.
export interface MirrorFileSystem {
  /** One read when `stableMs` is undefined; otherwise `changing` unless the file stays the same for `stableMs`. */
  read(path: string, stableMs?: number): Promise<MirrorFileRead>;
  /** Writes atomically, creating parent folders. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Deletes the file; a missing file is already removed. */
  remove(path: string): Promise<void>;
  /** The project files, sorted, then the shared tool files present; throws MirrorProjectDirUnavailable when the folder is. */
  list(): Promise<string[]>;
  /** Reports changed, created or deleted files; the returned function stops. Absent where the host feeds `changed`. */
  watch?(onChange: (path: string) => void): () => void;
}

/**
 * Thrown by a disk adapter when the project folder itself is gone or unreadable.
 * TRAP: reporting this as a missing file would look like the member deleted every file, and the share would lose them.
 */
export class MirrorProjectDirUnavailable extends Error {
  constructor(readonly folder: string, options?: { cause?: unknown }) {
    super(`${folder}: the shared project folder is missing or unreadable`, options);
    this.name = "MirrorRootUnavailable";
  }
}

/** What one look at a file shows: enough to tell that it changed between two looks. */
export interface MirrorSample { size: number; mtimeMs: number; bytes: Uint8Array }

const agree = (a: MirrorSample | undefined, b: MirrorSample | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.size === b.size && a.mtimeMs === b.mtimeMs && sameBytes(a.bytes, b.bytes);

/** One sample when `settleMs` is undefined; otherwise `changing` unless size, mtime and bytes agree `settleMs` later. */
export async function readStable(sample: () => Promise<MirrorSample | undefined>, settleMs?: number): Promise<MirrorFileRead> {
  const first = await sample();
  if (settleMs !== undefined) {
    await sleep(settleMs);
    if (!agree(first, await sample())) { return { state: "changing" }; }
  }
  return first ? { state: "present", bytes: first.bytes } : { state: "missing" };
}

type FileReads = Pick<ProjectReadContext, "fs" | "paths">;

/** Throws MirrorProjectDirUnavailable unless the folder is a directory whose entries can be listed. */
export async function assertProjectDirReadable({ fs }: FileReads, folder: string): Promise<void> {
  try {
    if ((await fs.stat(folder))?.isDirectory !== true) { throw new Error(`${folder}: not a folder`); }
    await fs.listDir(folder);
  } catch (error) {
    throw new MirrorProjectDirUnavailable(folder, { cause: error });
  }
}

/** The project files, then each shared tool file that is present. */
export async function listMirrorFiles(reads: FileReads, folder: string): Promise<string[]> {
  await assertProjectDirReadable(reads, folder);
  const files = await listProjectFiles(reads, folder);
  for (const tool of SHARED_TOOL_FILES) {
    if ((await reads.fs.stat(reads.paths.join(folder, ...tool.split("/"))))?.isFile === true) { files.push(tool); }
  }
  return files;
}

/** The disk of a project folder at `folder`, a "/"-separated path of the port. */
export function createLibraryMirrorFileSystem(fs: LibraryFileSystem, folder: string): MirrorFileSystem {
  const reads = { fs, paths: posixPathOps };
  const full = (relative: string) => posixPathOps.join(folder, ...relative.split("/"));

  async function sample(relative: string): Promise<MirrorSample | undefined> {
    try {
      const stat = await fs.stat(full(relative));
      if (stat?.isFile === true) { return { size: stat.size, mtimeMs: stat.mtimeMs, bytes: await fs.readFile(full(relative)) }; }
    } catch (error) {
      await assertProjectDirReadable(reads, folder);
      throw error;
    }
    await assertProjectDirReadable(reads, folder);
    return undefined;
  }

  return {
    async read(relative: string, stableMs?: number): Promise<MirrorFileRead> {
      return readStable(() => sample(relative), stableMs);
    },
    async write(relative: string, bytes: Uint8Array): Promise<void> {
      // ensureDir would bring a deleted project folder back with a single file in it.
      await assertProjectDirReadable(reads, folder);
      await fs.ensureDir(posixPathOps.dirname(full(relative)));
      await fs.writeFile(full(relative), bytes);
    },
    async remove(relative: string): Promise<void> {
      if ((await fs.stat(full(relative)))?.isFile === true) { await fs.deleteFile(full(relative)); }
    },
    list: () => listMirrorFiles(reads, folder),
  };
}
