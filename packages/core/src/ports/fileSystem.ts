// Declares the filesystem port that apps implement and inject.
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
