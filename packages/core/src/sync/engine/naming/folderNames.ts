// Builds the paperId ↔ Drive folder name maps for the "library" namespace.
import type { FolderNameMaps } from "../pipeline/index.js";

// CONTRACT: documents/contracts/sync.md#folder-names
// Every app syncing the same library must name Drive folders identically, or one reads the other's
// folders as new remote papers.

// Drive accepts almost any name, but control characters and path separators would break the local mapping back.
const UNSAFE_NAME_CHARS = /[\x00-\x1f\x7f/\\]/g;
const MAX_NAME_LENGTH = 255;

/**
 * The Drive folder name shown for one paper: its title without control characters or slashes, falling back to the id.
 * @returns the display name
 */
export function driveFolderName(paperId: string, title: string): string {
  return title.trim().replace(UNSAFE_NAME_CHARS, "").slice(0, MAX_NAME_LENGTH) || paperId;
}

/**
 * Translates paper folders (named by id locally) to title-named Drive folders and back.
 * @returns the maps passed to SyncEngine as libraryFolderNames
 */
export function buildLibraryFolderNames(titles: Iterable<readonly [paperId: string, title: string]>): FolderNameMaps {
  const localToRemote = new Map<string, string>();
  const remoteToLocal = new Map<string, string>();
  for (const [id, title] of titles) {
    const display = driveFolderName(id, title);
    localToRemote.set(id, display);
    remoteToLocal.set(display, id);
  }
  return { localToRemote, remoteToLocal };
}
