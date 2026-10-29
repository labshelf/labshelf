// Holds the in-memory library: the shapes a scan produces, the immutable snapshot built from it, the store that serves
// listings, search and change notification, and the re-indexing of paper records when a folder moves.
// Reloads are coalesced, so a burst of file events (a sync pulling twenty papers) costs one rescan.
import { createListeners } from "../events/index.js";
import type { PaperRecord } from "../model/index.js";
import { PAPERS_DIR } from "./layout.js";
import { isUnderDir, listPapersUnderFolder } from "./folderTree.js";
import { nameCollator, createPaperComparator } from "./paperOrder.js";
import { isEmptyQuery, matchPaper, matchTerms, parseQuery, searchDoc, type SearchDoc } from "./search.js";

export interface PaperEntry {
  record: PaperRecord;
  /** Collection path relative to papers/, "/"-separated ("" for the root). */
  collection: string;
  /** mtime of metadata.yaml, used by the "modified" sort. */
  modifiedMs: number;
  pdfBytes?: number;
}

/** What one pass over papers/ finds. */
export interface LibraryScan {
  /** One entry per paper id, in path order. */
  papers: PaperEntry[];
  /** Every collection path relative to papers/, empty ones included. */
  folders: string[];
  /** Folders that hold a paper.pdf and no metadata.yaml. */
  orphans: string[];
  /** Paper folders whose id was already taken by an earlier folder. */
  duplicates: string[];
}

export interface FolderNode {
  /** Path relative to papers/, "/"-separated; "" is the library root. */
  rel: string;
  name: string;
  parent: string | undefined;
  children: string[];
  /** Papers directly inside this collection. */
  paperIds: string[];
  /** Papers in this collection and every collection below it. */
  total: number;
}

export interface LibrarySnapshot {
  root: string;
  papers: ReadonlyMap<string, PaperEntry>;
  collections: ReadonlyMap<string, FolderNode>;
  duplicates: string[];
  orphans: string[];
  scannedAt: number;
}

/** "lastRead" orders by when the paper was last open in the reader, which the caller supplies. */
export type PaperSortColumn = "title" | "author" | "venue" | "year" | "status" | "modified" | "lastRead";

export interface SortSpec {
  key: PaperSortColumn;
  reverse: boolean;
}

/** A parsed search the library applies to its listings; the app supplies the query language. */
export interface PaperFilter {
  /** Whether a collection with this name stays in a listing. */
  keepsCollection(name: string): boolean;
  /** Relevance of a paper; a score of 0 or less hides it. */
  score(entry: PaperEntry): number;
}

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

interface CachedDoc { record: PaperRecord; annotations: string; notesText: string; doc: SearchDoc }

class PaperSearchIndex {
  private readonly docs = new Map<string, CachedDoc>();
  private annotationText = new Map<string, string>();
  private notesText = new Map<string, string>();

  /** The notes.qmd text per paper, so `note:`, `has:note` and plain words find a paper by its notes. */
  setNotesText(text: Map<string, string>): void {
    this.notesText = text;
  }

  /** Annotation text per paper, folded into the search so a highlight finds its paper. */
  setAnnotationText(text: Map<string, string>): void {
    this.annotationText = text;
  }

  /** @returns the filter for a query, or undefined when the query has no conditions */
  filterFor = (query: string): PaperFilter | undefined => {
    const parsed = parseQuery(query);
    if (isEmptyQuery(parsed)) { return undefined; }
    return {
      keepsCollection: (name) => matchTerms(parsed, name),
      score: (entry) => matchPaper(entry.record, this.doc(entry), parsed),
    };
  };

  /** @returns a test for whether a paper matches the query; every paper matches a query without conditions */
  matcher(query: string): (entry: PaperEntry) => boolean {
    const filter = this.filterFor(query);
    return filter ? (entry) => filter.score(entry) > 0 : () => true;
  }

  private doc(entry: PaperEntry): SearchDoc {
    const annotations = this.annotationText.get(entry.record.id) ?? "";
    const notesText = this.notesText.get(entry.record.id) ?? "";
    const cached = this.docs.get(entry.record.id);
    if (cached && cached.record === entry.record && cached.annotations === annotations && cached.notesText === notesText) { return cached.doc; }
    const doc = searchDoc(entry.record, { annotations, notesText });
    this.docs.set(entry.record.id, { record: entry.record, annotations, notesText, doc });
    return doc;
  }
}

export type LibraryEntry =
  | { kind: "collection"; node: FolderNode }
  | { kind: "paper"; paper: PaperEntry };

export interface ListOptions {
  sort: SortSpec;
  /** Show every paper below the collection, without sub-collections. */
  flatten?: boolean;
  /** Query text in the core query language. */
  filter?: string;
}

export interface LibraryStoreOptions {
  root: string;
  /** Reads the library from disk. `previous` holds the current entries by folder path, so a paper that fails to parse keeps its entry. */
  scan: (previous: ReadonlyMap<string, PaperEntry>) => Promise<LibraryScan>;
}

type Listener = (snapshot: LibrarySnapshot) => void;

export class LibraryStore {
  private current: LibrarySnapshot;
  private readonly listeners = createListeners<LibrarySnapshot>();
  private reloading: Promise<LibrarySnapshot> | undefined;
  private reloadAgain = false;
  private readonly searchIndex = new PaperSearchIndex();

  constructor(private readonly options: LibraryStoreOptions) {
    this.current = createEmptySnapshot(options.root);
  }

  /** @returns the latest snapshot */
  get snapshot(): LibrarySnapshot {
    return this.current;
  }

  /** @returns an unsubscribe function */
  onChange(listener: Listener): () => void {
    return this.listeners.add(listener);
  }

  /**
   * Rescans the library. Calls made while a scan runs are folded into one follow-up scan.
   * @returns the new snapshot
   */
  async reload(): Promise<LibrarySnapshot> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = this.scanUntilSettled();
    try {
      return await this.reloading;
    } finally {
      this.reloading = undefined;
    }
  }

  /** @returns the paper with this id in the latest snapshot */
  paper(id: string): PaperEntry | undefined {
    return this.current.papers.get(id);
  }

  /** @returns the collection at this path in the latest snapshot */
  collection(rel: string): FolderNode | undefined {
    return this.current.collections.get(rel);
  }

  /** @returns sub-collections (by name) then papers (by the sort spec) */
  listCollection(rel: string, options: ListOptions): LibraryEntry[] {
    const node = this.current.collections.get(rel);
    if (!node) { return []; }
    const filter = this.searchIndex.filterFor(options.filter ?? "");
    const entries: LibraryEntry[] = [];
    if (!options.flatten) {
      for (const childRel of node.children) {
        const child = this.current.collections.get(childRel);
        if (child && (!filter || filter.keepsCollection(child.name))) { entries.push({ kind: "collection", node: child }); }
      }
    }
    const papers = options.flatten
      ? listPapersUnderFolder(this.current, rel)
      : node.paperIds.map((id) => this.current.papers.get(id)).filter((paper): paper is PaperEntry => Boolean(paper));
    const kept = filter ? papers.filter((paper) => filter.score(paper) > 0) : papers;
    for (const paper of kept.sort(createPaperComparator(options.sort))) { entries.push({ kind: "paper", paper }); }
    return entries;
  }

  /** @returns matching papers, best match first (ties by the sort spec); every paper for an empty query */
  search(query: string, sort: SortSpec): PaperEntry[] {
    const filter = this.searchIndex.filterFor(query);
    const all = [...this.current.papers.values()];
    const compare = createPaperComparator(sort);
    if (!filter) { return all.sort(compare); }
    return all
      .map((paper) => ({ paper, score: filter.score(paper) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || compare(a.paper, b.paper))
      .map((result) => result.paper);
  }

  /** Annotation text per paper id, so a query finds a paper by its highlights and notes. */
  setAnnotationText(text: Map<string, string>): void {
    this.searchIndex.setAnnotationText(text);
  }

  /** The notes.qmd text per paper id, so a query finds a paper by its notes. */
  setNotesText(text: Map<string, string>): void {
    this.searchIndex.setNotesText(text);
  }

  /** @returns a test for whether a paper matches the query; every paper matches a query without conditions */
  matcher(query: string): (entry: PaperEntry) => boolean {
    return this.searchIndex.matcher(query);
  }

  /** @returns every tag in use with its count, most used first */
  tagCounts(): Array<{ tag: string; count: number }> {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const { record } of this.current.papers.values()) {
      for (const tag of record.tags ?? []) {
        const entry = counts.get(tag.toLowerCase()) ?? { tag, count: 0 };
        entry.count++;
        counts.set(tag.toLowerCase(), entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || nameCollator.compare(a.tag, b.tag));
  }

  private previousByPath(): ReadonlyMap<string, PaperEntry> {
    return new Map([...this.current.papers.values()].map((paper) => [paper.record.path, paper]));
  }

  private async scanUntilSettled(): Promise<LibrarySnapshot> {
    let snapshot: LibrarySnapshot;
    do {
      this.reloadAgain = false;
      snapshot = deriveSnapshot(this.options.root, await this.options.scan(this.previousByPath()));
    } while (this.reloadAgain);
    this.current = snapshot;
    this.listeners.emit(snapshot);
    return snapshot;
  }
}


/** The index surface the reindexing needs, so the browser can pass a small adapter over its IndexedDB record store. */
export interface IPaperRecordCache {
  listPapers(): Promise<PaperRecord[]>;
  upsertPaper(paper: PaperRecord): Promise<void>;
  deletePaper(id: string): Promise<void>;
}

/** Upserts every paper under `oldDir` with its path re-rooted under `newDir` (paths are "/"-separated). */
export async function movePapersUnder(index: IPaperRecordCache, oldDir: string, newDir: string): Promise<void> {
  for (const paper of await index.listPapers()) {
    if (!isUnderDir(paper.path, oldDir, "/")) continue;
    await index.upsertPaper({ ...paper, path: newDir + paper.path.slice(oldDir.length) });
  }
}

/** Deletes every paper record whose stored path lies under `dirPath`. */
export async function removePapersUnder(index: IPaperRecordCache, dirPath: string): Promise<void> {
  for (const paper of await index.listPapers()) {
    if (isUnderDir(paper.path, dirPath, "/")) await index.deletePaper(paper.id);
  }
}
