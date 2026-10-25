/** Computes paths for browsing the folder tree: breadcrumbs, labels and recursive counts. Every function takes the
 * separator, so absolute file paths (VS Code) and "papers/..." store keys (browser) share one implementation. */
export const ROOT_LABEL = "All papers";
/** What a folder view and a paper's Folder field call the library root. */
export const LIBRARY_LABEL = "Library";

/** @returns whether `paperPath` is `dirPath` or lies beneath it, for the given separator */
export function isUnderDir(paperPath: string, dirPath: string, sep: string): boolean {
  return paperPath === dirPath || paperPath.startsWith(dirPath + sep);
}

export interface Crumb {
  label: string;
  path: string;
  isRoot: boolean;
}

/** @returns the parent folder of `path`; `path` itself when it has none */
export function deriveParentDir(path: string, sep: string): string {
  const index = path.lastIndexOf(sep);
  return index <= 0 ? path : path.slice(0, index);
}

/** @returns the last segment of `path` */
export function deriveBaseName(path: string, sep: string): string {
  return path.slice(path.lastIndexOf(sep) + sep.length);
}

/** @returns the root-first chain of folders from `root` down to `path`; just the root when `path` is outside it */
export function deriveBreadcrumb(root: string, path: string, sep: string): Crumb[] {
  const chain: Crumb[] = [{ label: ROOT_LABEL, path: root, isRoot: true }];
  if (path === root || !isUnderDir(path, root, sep)) { return chain; }
  let current = root;
  for (const segment of path.slice(root.length + sep.length).split(sep)) {
    current = current + sep + segment;
    chain.push({ label: segment, path: current, isRoot: false });
  }
  return chain;
}

/** @returns the name the UI shows for a folder: "All papers" for the root */
export function formatFolderLabel(root: string, path: string, sep: string): string {
  return path === root || path === "" ? ROOT_LABEL : deriveBaseName(path, sep);
}

/** @returns the folder's location inside the library as the UI shows it: "Thesis / Chapter 2", or "All papers" for the root */
export function formatFolderPathLabel(root: string, path: string, sep: string): string {
  if (path === root || !isUnderDir(path, root, sep)) { return ROOT_LABEL; }
  return path.slice(root.length + sep.length).split(sep).join(" / ");
}

/** @returns how many of `paperPaths` sit at any depth under `dir` */
export function countPapersUnder(paperPaths: readonly string[], dir: string, sep: string): number {
  let count = 0;
  for (const path of paperPaths) {
    if (isUnderDir(path, dir, sep)) { count++; }
  }
  return count;
}

/** @returns the folder holding the paper, relative to `dir` and joined with " / "; empty when the paper sits directly in `dir` */
export function deriveRelativeFolder(paperPath: string, dir: string, sep: string): string {
  const holder = deriveParentDir(paperPath, sep);
  if (holder === dir || !isUnderDir(holder, dir, sep)) { return ""; }
  return holder.slice(dir.length + sep.length).split(sep).join(" / ");
}
