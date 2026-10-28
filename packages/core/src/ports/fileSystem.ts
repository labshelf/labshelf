/**
 * Declares the file-system ports apps implement and inject: the text port, the local byte port sync and scans use,
 * and the library port mutations write through.
 */

// INVARIANT: paths are POSIX-style strings, never platform URI objects.
export interface IFileSystem {
  /** Creates a directory (and any parents) at the given path, idempotent. */
  ensureDir(path: string): Promise<void>;
  /** Writes a UTF-8 string to a file, overwriting any existing content. */
  writeText(path: string, content: string): Promise<void>;
  /** Reads a file and returns its contents as a UTF-8 string. */
  readText(path: string): Promise<string>;
  /** Returns true if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;
}

export interface LocalStat {
  isFile: boolean;
  isDirectory: boolean;
  /** Epoch milliseconds of the last modification. */
  mtimeMs: number;
  size: number;
}

/**
 * Platform-agnostic local filesystem abstraction. The concrete adapter is
 * injected; this module never imports vscode or node:fs directly.
 */
export interface LocalFileSystem {
  /** Lists immediate child names of a directory. Returns [] if missing. */
  listDir(dirPath: string): Promise<string[]>;
  readFile(filePath: string): Promise<Uint8Array>;
  writeFile(filePath: string, content: Uint8Array): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  /** Returns undefined when the path does not exist. */
  stat(targetPath: string): Promise<LocalStat | undefined>;
  /** Ensures a directory (and parents) exist. */
  ensureDir(dirPath: string): Promise<void>;
}

// INVARIANT: writeFile and writeText are atomic in every adapter: a reader sees the old content or the new, never half.
export interface LibraryFileSystem extends IFileSystem, LocalFileSystem {
  /** Fails when the destination exists, except for a rename that changes only letter case; callers check first. */
  rename(from: string, to: string): Promise<void>;
  /** Moves to the platform trash where one exists, deletes permanently otherwise. */
  trash(target: string): Promise<void>;
  /** Deletes a file or folder tree permanently, never through the trash; a missing target is already removed. */
  removeTree(target: string): Promise<void>;
  /** Creates a folder that exists even while it is empty (the browser store keeps a marker for it). */
  mkdir(dir: string): Promise<void>;
}
