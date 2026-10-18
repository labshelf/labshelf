// Lists a library folder's entries with whether each is a file or a folder.
import type { LibraryFileSystem } from "@labshelf/core";

export interface FolderEntry {
  name: string;
  kind: "file" | "directory";
}

/** A missing folder has no entries; an entry gone between the listing and its stat is left out. */
export async function listFolderEntries(fileSystem: LibraryFileSystem, folder: string): Promise<FolderEntry[]> {
  const names = await fileSystem.listDir(folder);
  const prefix = folder === "" ? "" : `${folder}/`;
  const stats = await Promise.all(names.map((name) => fileSystem.stat(`${prefix}${name}`)));
  return names.flatMap((name, index): FolderEntry[] => {
    const found = stats[index];
    return found === undefined ? [] : [{ name, kind: found.isDirectory ? "directory" : "file" }];
  });
}
