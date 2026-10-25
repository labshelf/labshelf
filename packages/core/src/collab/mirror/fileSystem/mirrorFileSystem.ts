// Declares the disk port the shared-project mirror reads, writes and watches its folder through.
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
