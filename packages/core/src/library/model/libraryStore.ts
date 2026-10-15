// Holds the in-memory library snapshot with collection listings, search and change notification.
// Reloads are coalesced, so a burst of file events (a sync pulling twenty papers) costs one rescan.
import { snapshotFromScan, emptySnapshot } from "./snapshot.js";
import { papersUnder } from "./collectionTree.js";
import { nameCollator, paperComparator } from "./paperSort.js";
import { PaperSearchIndex } from "./paperSearchIndex.js";
import type { CollectionNode, LibraryScan, LibrarySnapshot, PaperEntry, SortSpec } from "./types.js";

export type LibraryEntry =
  | { kind: "collection"; node: CollectionNode }
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
  /** Reads the library from disk. */
  scan: () => Promise<LibraryScan>;
}

type Listener = (snapshot: LibrarySnapshot) => void;

export class LibraryStore {
  private current: LibrarySnapshot;
  private readonly listeners = new Set<Listener>();
  private reloading: Promise<LibrarySnapshot> | undefined;
  private reloadAgain = false;
  private readonly searchIndex = new PaperSearchIndex();

  constructor(private readonly options: LibraryStoreOptions) {
    this.current = emptySnapshot(options.root);
  }

  /** @returns the latest snapshot */
  get snapshot(): LibrarySnapshot {
    return this.current;
  }

  /** @returns an unsubscribe function */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
  collection(rel: string): CollectionNode | undefined {
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
      ? papersUnder(this.current, rel)
      : node.paperIds.map((id) => this.current.papers.get(id)).filter((paper): paper is PaperEntry => Boolean(paper));
    const kept = filter ? papers.filter((paper) => filter.score(paper) > 0) : papers;
    for (const paper of kept.sort(paperComparator(options.sort))) { entries.push({ kind: "paper", paper }); }
    return entries;
  }

  /** @returns matching papers, best match first (ties by the sort spec); every paper for an empty query */
  search(query: string, sort: SortSpec): PaperEntry[] {
    const filter = this.searchIndex.filterFor(query);
    const all = [...this.current.papers.values()];
    const compare = paperComparator(sort);
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

  private async scanUntilSettled(): Promise<LibrarySnapshot> {
    let snapshot: LibrarySnapshot;
    do {
      this.reloadAgain = false;
      snapshot = snapshotFromScan(this.options.root, await this.options.scan());
    } while (this.reloadAgain);
    this.current = snapshot;
    for (const listener of this.listeners) { listener(snapshot); }
    return snapshot;
  }
}
