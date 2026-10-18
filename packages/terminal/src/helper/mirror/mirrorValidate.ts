// Validates the project id, paths and file list of a mirror request, rejecting with the contract's codes.
// CONTRACT: documents/contracts/helper.md#limits
import { CHUNK_MAX_BYTES, MAX_SYNC_FILES, MAX_SYNC_TOTAL_BYTES, checkHelperPath, isHelperProjectId } from "@labshelf/core/helper";
import type { SyncedFile } from "@labshelf/core/helper";

import { MirrorRejection } from "./mirrorTypes.js";

const SHA256 = /^[0-9a-f]{64}$/;

export function requireProjectId(projectId: string): void {
  if (!isHelperProjectId(projectId)) { throw new MirrorRejection("project-id", "project id is not a derived project id", { projectId }); }
}

export function requirePath(relPath: string): void {
  const problem = checkHelperPath(relPath);
  if (problem !== undefined) { throw new MirrorRejection("path", problem, { path: relPath }); }
}

export function requirePathCount(count: number, what: string): void {
  if (count > MAX_SYNC_FILES) { throw new MirrorRejection("limit", `${what} exceeds ${MAX_SYNC_FILES}`, { count }); }
}

/** The number of chunks a file of `size` bytes travels in; an empty file is one chunk. */
export function chunkCountFor(size: number): number {
  return Math.max(1, Math.ceil(size / CHUNK_MAX_BYTES));
}

/** Throws unless `files` obeys the sync limits and lists each safe path once, never as both a file and a folder. */
export function requireSyncFiles(files: readonly SyncedFile[]): void {
  requirePathCount(files.length, "file count");
  const seen = new Set<string>();
  const folders = new Set<string>();
  let total = 0;
  for (const file of files) {
    requirePath(file.path);
    if (seen.has(file.path)) { throw new MirrorRejection("invalid-field", "path is listed twice", { path: file.path }); }
    seen.add(file.path);
    if (!SHA256.test(file.sha256)) { throw new MirrorRejection("invalid-field", "sha256 is not lowercase hex", { path: file.path }); }
    if (!Number.isSafeInteger(file.size) || file.size < 0) { throw new MirrorRejection("invalid-field", "size is not a byte count", { path: file.path }); }
    total += file.size;
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i += 1) { folders.add(parts.slice(0, i).join("/")); }
  }
  if (total > MAX_SYNC_TOTAL_BYTES) { throw new MirrorRejection("limit", `declared size exceeds ${MAX_SYNC_TOTAL_BYTES} bytes`, { total }); }
  const clash = [...folders].find((folder) => seen.has(folder));
  if (clash !== undefined) { throw new MirrorRejection("path", "a path is both a file and a folder", { path: clash }); }
}
