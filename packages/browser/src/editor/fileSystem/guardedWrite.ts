// Writes a project file only when the store still holds what the editor last read, so a concurrent edit is never overwritten.
// Files the editor never read are written through.
import type { ILogger } from "@labshelf/core";
import { ProjectFileNotFoundError } from "../../storage/projects";
import { ProjectFileSystemError } from "./fileSystemError";

const MODULE = "browser.editor.fileSystem";

export interface ProjectFileStore {
  readProjectFile(id: string, path: string): Promise<Uint8Array>;
  writeProjectFile(id: string, path: string, bytes: Uint8Array): Promise<void>;
}

export interface WriteRequest {
  projectId: string;
  path: string;
  content: Uint8Array;
  create: boolean;
  overwrite: boolean;
  /** The bytes the editor last read or saved for this file; undefined when it never read it. */
  baseline: Uint8Array | undefined;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Resolves with whether the file was created; throws a ProjectFileSystemError and leaves the store untouched on a conflict. */
export async function guardedWrite(store: ProjectFileStore, logger: ILogger, request: WriteRequest): Promise<boolean> {
  const { projectId, path, content, create, overwrite, baseline } = request;
  const context = { project: projectId, path, action: "write" };
  try {
    // INVARIANT: the store has no mtime or compare-and-swap, so "unchanged" means the stored bytes equal the editor's baseline.
    // TRAP: only a missing file counts as absent; any other read failure must stop the write, or create would overwrite it.
    const current = await store.readProjectFile(projectId, path).catch((error: unknown) => {
      if (error instanceof ProjectFileNotFoundError) return undefined;
      throw error;
    });
    if (current === undefined && !create) throw new ProjectFileSystemError("EntryNotFound", `${path} does not exist`);
    if (current !== undefined) {
      if (!overwrite) throw new ProjectFileSystemError("EntryExists", `${path} already exists`);
      // A file the editor never read has no edit of its own to protect (build outputs), so it is written through as on desktop.
      if (baseline !== undefined && !sameBytes(baseline, current)) throw new ProjectFileSystemError("Unavailable", `${path} changed since the editor read it; reload it before saving`);
    }
    await store.writeProjectFile(projectId, path, content);
    return current === undefined;
  } catch (error) {
    await logger.error(MODULE, error, context);
    if (error instanceof ProjectFileSystemError) throw error;
    throw new ProjectFileSystemError("Unavailable", `Could not write ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
