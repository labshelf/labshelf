/**
 * Reads the "files" IndexedDB store's path keys and derives the collection tree and the PDF-presence set from them
 * with core. No separate store is maintained: the tree changes only after a sync cycle or a folder mutation.
 */
import { PAPERS_DIR, collectionsFromFilePaths, pdfDirsFromFilePaths, type FolderTreeNode } from "@labshelf/core";
import { getDb } from "./idb/db";

async function fileKeysUnder(rootPath: string): Promise<string[]> {
  const db = await getDb();
  const prefix = `${rootPath}/`;
  return (await db.getAllKeys("files", IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, true))) as string[];
}

/** Builds the collection tree under `rootPath` from a single key scan. */
export async function buildFolderTree(rootPath: string = PAPERS_DIR): Promise<FolderTreeNode[]> {
  return collectionsFromFilePaths(await fileKeysUnder(rootPath), rootPath);
}

/**
 * One key scan feeding both the collection tree and the PDF-presence set, so the library page's load and refresh
 * cost a single IndexedDB round trip.
 */
export async function scanLibrary(rootPath: string = PAPERS_DIR): Promise<{ tree: FolderTreeNode[]; pdfDirs: Set<string> }> {
  const keys = await fileKeysUnder(rootPath);
  return { tree: collectionsFromFilePaths(keys, rootPath), pdfDirs: pdfDirsFromFilePaths(keys) };
}

/** The folders holding a paper.pdf, for the background's library.lookup / draftView (which do not need the tree). */
export async function pdfDirs(rootPath: string = PAPERS_DIR): Promise<Set<string>> {
  return pdfDirsFromFilePaths(await fileKeysUnder(rootPath));
}
