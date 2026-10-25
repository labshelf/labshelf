/** Builds the immutable snapshot of the library (collection tree with counts, papers by id) from a scan. */
import { PAPERS_DIR } from "../layout.js";
import { nameCollator } from "./paperSort.js";
import type { FolderNode, LibraryScan, LibrarySnapshot, PaperEntry } from "./librarySnapshot.js";

function rootCollection(): FolderNode {
  return { rel: "", name: PAPERS_DIR, parent: undefined, children: [], paperIds: [], total: 0 };
}

// Creates the node for `rel` and every ancestor that does not exist yet.
function ensureNode(collections: Map<string, FolderNode>, rel: string): FolderNode {
  const existing = collections.get(rel);
  if (existing) { return existing; }
  const slash = rel.lastIndexOf("/");
  const parent = ensureNode(collections, slash < 0 ? "" : rel.slice(0, slash));
  const node: FolderNode = { rel, name: rel.slice(slash + 1), parent: parent.rel, children: [], paperIds: [], total: 0 };
  collections.set(rel, node);
  parent.children.push(rel);
  return node;
}

function countPaper(collections: Map<string, FolderNode>, entry: PaperEntry): void {
  const home = ensureNode(collections, entry.collection);
  home.paperIds.push(entry.record.id);
  for (let node: FolderNode | undefined = home; node; node = node.parent === undefined ? undefined : collections.get(node.parent)) {
    node.total++;
  }
}

/** @returns a snapshot with no papers and only the root collection */
export function createEmptySnapshot(root: string): LibrarySnapshot {
  return { root, papers: new Map(), collections: new Map([["", rootCollection()]]), duplicates: [], orphans: [], scannedAt: 0 };
}

/** @returns the snapshot of a scan; each collection lists its sub-collections by name */
export function deriveSnapshot(root: string, scan: LibraryScan, scannedAt: number = Date.now()): LibrarySnapshot {
  const collections = new Map<string, FolderNode>([["", rootCollection()]]);
  for (const rel of scan.folders) { ensureNode(collections, rel); }
  const papers = new Map<string, PaperEntry>();
  for (const entry of scan.papers) {
    papers.set(entry.record.id, entry);
    countPaper(collections, entry);
  }
  for (const node of collections.values()) {
    node.children.sort((a, b) => nameCollator.compare(collections.get(a)!.name, collections.get(b)!.name));
  }
  return { root, papers, collections, duplicates: [...scan.duplicates], orphans: [...scan.orphans], scannedAt };
}
