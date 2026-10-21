// Builds the nested folder tree of a Space with each paper reference resolved.
import type { Space } from "../model/index.js";
import { resolvePaper, type LibraryPapers } from "./resolvePaper.js";
import type { PapersTree, PapersTreeFolder } from "./viewTypes.js";

export function buildPapersTree(space: Space, library: LibraryPapers): PapersTree {
  const ids = new Set(space.folders.map((f) => f.id));
  // A folder whose parent is missing sits at the root, as the reader already does for the file.
  const parentOf = (f: { parent?: string | undefined }): string | undefined => (f.parent !== undefined && ids.has(f.parent) ? f.parent : undefined);
  const papersIn = (folder: string | undefined) =>
    space.papers.filter((p) => (p.folder !== undefined && ids.has(p.folder) ? p.folder : undefined) === folder).map((p) => resolvePaper(p.id, library));
  const foldersIn = (parent: string | undefined, seen: ReadonlySet<string>): PapersTreeFolder[] =>
    space.folders.filter((f) => parentOf(f) === parent && !seen.has(f.id)).map((f) => ({
      id: f.id,
      name: f.name,
      folders: foldersIn(f.id, new Set([...seen, f.id])),
      papers: papersIn(f.id),
    }));
  return { folders: foldersIn(undefined, new Set()), papers: papersIn(undefined) };
}
