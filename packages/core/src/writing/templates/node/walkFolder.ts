/** Lists every regular file under a folder with lstat, refusing symbolic links and anything that is not a file or folder. */
import * as fs from "node:fs";
import * as path from "node:path";

export interface FoundFile {
  /** Relative to the walked folder, segments joined by `/`. */
  path: string;
  absolute: string;
  size: number;
  nlink: number;
}

/** Whether to leave out an entry, given its `/`-joined relative path; a skipped folder is not entered. */
export type SkipEntry = (relativePath: string, name: string) => boolean;

// TRAP: tar extracts symlinks and a project may hold them, so this lstat walk is the only guard between a tree and the files it points at.
async function walk(root: string, relative: string, skip: SkipEntry, found: FoundFile[]): Promise<void> {
  const directory = relative === "" ? root : path.join(root, ...relative.split("/"));
  for (const name of await fs.promises.readdir(directory)) {
    const rel = relative === "" ? name : `${relative}/${name}`;
    if (skip(rel, name)) { continue; }
    const absolute = path.join(directory, name);
    const stat = await fs.promises.lstat(absolute);
    if (stat.isSymbolicLink()) { throw new Error(`"${rel}" is a symbolic link`); }
    if (stat.isDirectory()) { await walk(root, rel, skip, found); continue; }
    if (!stat.isFile()) { throw new Error(`"${rel}" is not a regular file`); }
    found.push({ path: rel, absolute, size: stat.size, nlink: stat.nlink });
  }
}

/** The folder's files sorted by relative path; throws naming the path of the first symbolic link or special file. */
export async function walkFolder(folder: string, skip: SkipEntry = () => false): Promise<FoundFile[]> {
  const root = await fs.promises.lstat(folder);
  if (!root.isDirectory()) { throw new Error(`${folder} is not a folder`); }
  const found: FoundFile[] = [];
  await walk(folder, "", skip, found);
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
