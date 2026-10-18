// Lists every regular file under a library folder, refusing symbolic links and anything that is not a file or folder.
import type { LibraryFileSystem } from "../../../ports/index.js";
import type { PathOps } from "../../../library/index.js";

export interface LibraryFile {
  /** Relative to the walked folder, segments joined by `/`. */
  path: string;
  absolute: string;
  size: number;
}

// TRAP: a library stat reports a symbolic link as neither file nor folder, so this walk is the only guard between a tree and the files it points at.
async function walk(fs: LibraryFileSystem, paths: PathOps, directory: string, relative: string, found: LibraryFile[]): Promise<void> {
  for (const name of await fs.listDir(directory)) {
    const rel = relative === "" ? name : `${relative}/${name}`;
    const absolute = paths.join(directory, name);
    const stat = await fs.stat(absolute);
    if (stat?.isDirectory === true) { await walk(fs, paths, absolute, rel, found); continue; }
    if (stat?.isFile !== true) { throw new Error(`"${rel}" is not a regular file`); }
    found.push({ path: rel, absolute, size: stat.size });
  }
}

/** The folder's files sorted by relative path; throws naming the path of the first symbolic link or special file. */
export async function walkLibraryFolder(fs: LibraryFileSystem, paths: PathOps, folder: string): Promise<LibraryFile[]> {
  if ((await fs.stat(folder))?.isDirectory !== true) { throw new Error(`${folder} is not a folder`); }
  const found: LibraryFile[] = [];
  await walk(fs, paths, folder, "", found);
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
