// Declares the Space store's options, its internal context and the error for refused writes.
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { LibraryLayout } from "../../library/index.js";
import type { PathOps } from "../../path/index.js";

export interface SpaceStoreOptions {
  /** The library folder. */
  readonly root: string;
  readonly fs: LibraryFileSystem;
  readonly paths: Pick<PathOps, "join">;
  readonly logger: ILogger;
  /** ISO timestamp for createdAt and addedAt; the wall clock when absent. */
  readonly now?: () => string;
}

export interface StoreContext {
  readonly fs: LibraryFileSystem;
  readonly logger: ILogger;
  readonly layout: LibraryLayout<string>;
  readonly now: () => string;
  /** The tail of each key's write queue: a space id, or the spaces root for creation. */
  readonly writes: Map<string, Promise<unknown>>;
}

export const SPACE_STORE_MODULE = "spaces/store";

/** Thrown when a write is refused because the file is from a newer version or could not be understood. */
export class SpaceReadOnlyError extends Error {
  override readonly name = "SpaceReadOnlyError";
  constructor(readonly path: string, readonly reason: string) {
    super(`${path} is read-only: ${reason}`);
  }
}
