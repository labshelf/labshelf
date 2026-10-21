// Moves folders and papers whose folder reference is missing or on a parent cycle to the Space root.
// CONTRACT: documents/contracts/spaces.md#reading
import type { SpaceFolder, SpacePaperRef } from "./types.js";

function withoutKey<T extends object, K extends keyof T>(entry: T, key: K): T {
  const { [key]: _dropped, ...rest } = entry;
  return rest as T;
}

/** Ids of folders whose parent chain loops back on itself. */
function foldersOnCycles(parentOf: ReadonlyMap<string, string | undefined>): Set<string> {
  const onCycle = new Set<string>();
  for (const start of parentOf.keys()) {
    const path: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined && !path.includes(current) && !onCycle.has(current)) {
      path.push(current);
      current = parentOf.get(current);
    }
    if (current !== undefined && path.includes(current)) {
      path.slice(path.indexOf(current)).forEach((id) => onCycle.add(id));
    }
  }
  return onCycle;
}

export function resolveSpaceReferences(
  folders: readonly SpaceFolder[], papers: readonly SpacePaperRef[], warnings: string[],
): { folders: SpaceFolder[]; papers: SpacePaperRef[] } {
  const ids = new Set(folders.map((folder) => folder.id));
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parent !== undefined && ids.has(folder.parent) ? folder.parent : undefined]));
  const onCycle = foldersOnCycles(parentOf);
  const resolvedFolders = folders.map((folder) => {
    if (folder.parent === undefined) { return folder; }
    if (!ids.has(folder.parent)) { warnings.push(`folder ${folder.id}: parent ${folder.parent} is missing, read as root`); }
    else if (onCycle.has(folder.id)) { warnings.push(`folder ${folder.id}: on a parent cycle, read as root`); }
    else { return folder; }
    return withoutKey(folder, "parent");
  });
  const resolvedPapers = papers.map((paper) => {
    if (paper.folder === undefined || ids.has(paper.folder)) { return paper; }
    warnings.push(`paper ${paper.id}: folder ${paper.folder} is missing, read as root`);
    return withoutKey(paper, "folder");
  });
  return { folders: resolvedFolders, papers: resolvedPapers };
}
