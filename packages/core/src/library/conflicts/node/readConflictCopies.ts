// Lists the paper data folders of a library and the conflict copies of one file that sit next to it in its folder.
import * as path from "node:path";

import type { LibraryLayout } from "../../layout.js";
import type { ConflictCopy, ConflictOwner } from "../conflictCopy.js";
import { parseConflictName } from "../conflictNames.js";
import { readDirOrEmpty } from "./readDirOrEmpty.js";

/** @returns the copies of `dir/<fileName>` in `dir`, none when the folder does not exist. */
export async function readConflictCopies(dir: string, fileName: string, owner: ConflictOwner): Promise<ConflictCopy[]> {
  const original = path.join(dir, fileName);
  const copies: ConflictCopy[] = [];
  for (const entry of await readDirOrEmpty(dir)) {
    const parsed = entry.isFile() ? parseConflictName(entry.name) : null;
    if (parsed?.original === fileName) {
      copies.push({ owner, original, copy: path.join(dir, entry.name), tool: parsed.tool });
    }
  }
  return copies;
}

/** @returns every paper data folder with its paper id, none when the library has no paper data yet. */
export async function listPaperFolders(layout: LibraryLayout<string>): Promise<Array<{ id: string; dir: string }>> {
  const papers = await readDirOrEmpty(layout.paperDataRoot());
  return papers.filter((paper) => paper.isDirectory()).map((paper) => ({ id: paper.name, dir: layout.paperDataDir(paper.name) }));
}
