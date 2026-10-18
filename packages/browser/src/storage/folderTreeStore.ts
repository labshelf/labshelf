/**
 * Derives the collection tree and the PDF-presence set from a walk of the active library source, with core.
 * No separate store is maintained: the tree changes only after a folder mutation.
 */
import { PAPERS_DIR, collectionsFromFilePaths, pdfDirsFromFilePaths, type FolderTreeNode } from "@labshelf/core";
import { createLibraryFileSystem } from "./libraryFileSystem";

/**
 * @returns every file path below `dir`, plus `<folder>/` for each empty folder.
 * An empty folder on disk has no file to derive it from, so the trailing slash still makes it an ancestor in core's
 * derivation; a browser-storage folder is never empty, since its `.keep` is a file.
 */
async function pathsUnder(dir: string): Promise<string[]> {
  const fs = createLibraryFileSystem();
  const names = await fs.listDir(dir);
  if (names.length === 0) return [`${dir}/`];
  const nested = await Promise.all(names.map(async (name) => {
    const path = `${dir}/${name}`;
    const found = await fs.stat(path);
    if (found?.isDirectory) return pathsUnder(path);
    return found?.isFile ? [path] : [];
  }));
  return nested.flat();
}

async function libraryPaths(rootPath: string): Promise<string[]> {
  return (await createLibraryFileSystem().stat(rootPath))?.isDirectory ? pathsUnder(rootPath) : [];
}

/** Builds the collection tree under `rootPath` from one walk. */
export async function buildFolderTree(rootPath: string = PAPERS_DIR): Promise<FolderTreeNode[]> {
  return collectionsFromFilePaths(await libraryPaths(rootPath), rootPath);
}

/** One walk feeding both the collection tree and the PDF-presence set, for the library page's load and refresh. */
export async function scanLibrary(rootPath: string = PAPERS_DIR): Promise<{ tree: FolderTreeNode[]; pdfDirs: Set<string> }> {
  const paths = await libraryPaths(rootPath);
  return { tree: collectionsFromFilePaths(paths, rootPath), pdfDirs: pdfDirsFromFilePaths(paths) };
}

/** The folders holding a paper.pdf, for the background's library.lookup / draftView (which do not need the tree). */
export async function pdfDirs(rootPath: string = PAPERS_DIR): Promise<Set<string>> {
  return pdfDirsFromFilePaths(await libraryPaths(rootPath));
}
