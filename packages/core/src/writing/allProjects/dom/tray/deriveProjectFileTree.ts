// Orders a project's file paths into the tray's visible rows, unfolding only the folders that are open.

export interface FileTreeEntry {
  /** Relative to the project, "/"-separated. */
  path: string;
  name: string;
  depth: number;
  folder: boolean;
  open: boolean;
}

interface FolderNode {
  folders: Map<string, FolderNode>;
  files: string[];
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
const folderNode = (): FolderNode => ({ folders: new Map(), files: [] });

function insert(root: FolderNode, path: string): void {
  const parts = path.split("/");
  let node = root;
  for (const part of parts.slice(0, -1)) {
    let child = node.folders.get(part);
    if (!child) { child = folderNode(); node.folders.set(part, child); }
    node = child;
  }
  node.files.push(parts[parts.length - 1]!);
}

function emit(node: FolderNode, prefix: string, depth: number, open: ReadonlySet<string>, out: FileTreeEntry[]): void {
  for (const name of [...node.folders.keys()].sort(byName)) {
    const path = prefix + name;
    const isOpen = open.has(path);
    out.push({ path, name, depth, folder: true, open: isOpen });
    if (isOpen) emit(node.folders.get(name)!, `${path}/`, depth + 1, open, out);
  }
  for (const name of [...node.files].sort(byName)) out.push({ path: prefix + name, name, depth, folder: false, open: false });
}

/** Folders come before files at every level; `open` holds the paths of the unfolded folders. */
export function deriveProjectFileTree(paths: readonly string[], open: ReadonlySet<string>): FileTreeEntry[] {
  const root = folderNode();
  for (const path of paths) insert(root, path);
  const out: FileTreeEntry[] = [];
  emit(root, "", 0, open, out);
  return out;
}
