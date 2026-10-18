/** Declares the file-system port library mutations write through: text and byte access plus folder rename, creation and removal. */
import type { IFileSystem } from "./fileSystem.js";
import type { LocalFileSystem } from "./localFileSystem.js";

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
