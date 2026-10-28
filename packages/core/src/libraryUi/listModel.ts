// Derives the paper list: rows, scope, sort order, tag counts, related papers and the list keymap.
import {
  isUnderDir, deriveParentDir, deriveRelativeFolder, isEmptyQuery, isPaperMatch, searchDoc, type Query, parseQuery, createPaperRecordComparator, type PaperSortColumn, normalizeAuthor, type ReadingStatus,
} from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import type { LibraryViewState, SortDir, SortColumn } from "./store/index.js";
import type { PaperStats, SimilarPaper } from "./protocol/index.js";

const SEP = "/";

/** A paper as the list sees it: the record plus where it sits relative to the open folder. */
export interface ListPaper extends PaperRecord {
  /** Folder holding the paper (parent of `path`). */
  folderPath: string;
  /** Holder folder relative to the open folder, " / "-joined; empty when directly inside. */
  relFolder: string;
  /** Whether the paper's folder holds its PDF. */
  hasPdf: boolean;
}

const NO_PDF_DIRS: ReadonlySet<string> = new Set();

/** The papers stored under `folder`, decorated for the list; `pdfDirs` holds the record paths that have a PDF. */
export function listPapersUnder(all: readonly PaperRecord[], folder: string, pdfDirs: ReadonlySet<string> = NO_PDF_DIRS): ListPaper[] {
  return all
    .filter((p) => isUnderDir(p.path, folder, SEP) && p.path !== folder)
    .map((p) => ({ ...p, folderPath: deriveParentDir(p.path, SEP), relFolder: deriveRelativeFolder(p.path, folder, SEP), hasPdf: pdfDirs.has(p.path) }));
}

/** Papers a search lets through. A search also matches the folder path shown in the row. */
export function findPapersInScope(papers: ListPaper[], query: Query): ListPaper[] {
  if (isEmptyQuery(query)) return papers;
  return papers.filter((p) => isPaperMatch(p, searchDoc(p, { folder: p.relFolder }), query));
}

export interface ListScope {
  /** Every paper under the open folder, nested ones included. */
  inFolder: ListPaper[];
  /** The papers the search lets through, unsorted. */
  shown: ListPaper[];
  /** The search terms to highlight. */
  terms: string[];
}

export interface ListView extends ListScope {
  /** The rows to show, in order. */
  rows: ListPaper[];
}

type ScopeInputs = Pick<LibraryViewState, "papers" | "folder" | "pdfDirs" | "query">;

export function deriveScope(s: ScopeInputs): ListScope {
  const query = parseQuery(s.query);
  const inFolder = listPapersUnder(s.papers, s.folder, s.pdfDirs);
  const shown = findPapersInScope(inFolder, query);
  return { inFolder, shown, terms: query.terms };
}

export function deriveListView(s: ScopeInputs & Pick<LibraryViewState, "sortKey" | "sortDir" | "stats">): ListView {
  const scoped = deriveScope(s);
  return { ...scoped, rows: orderPapers(scoped.shown, s.sortKey, s.sortDir, s.stats) };
}

const CORE_SORT_KEY: Record<SortColumn, PaperSortColumn> = {
  title: "title", creator: "author", venue: "venue", year: "year", lastRead: "lastRead", status: "status",
};

// Core orders these newest first; their ascending arrow (dir 1) means oldest first, so they read the direction the other way round.
const NEWEST_FIRST: ReadonlySet<SortColumn> = new Set(["year", "lastRead"]);

/** Sorts by the chosen column with title as the tiebreaker; `stats` gives Last read. Returns a new array. */
export function orderPapers(papers: ListPaper[], key: SortColumn, dir: SortDir, stats: Readonly<Record<string, PaperStats>> = {}): ListPaper[] {
  const reverse = NEWEST_FIRST.has(key) ? dir === 1 : dir === -1;
  return [...papers].sort(createPaperRecordComparator({ key: CORE_SORT_KEY[key], reverse }, (p) => stats[p.id]?.lastRead));
}

/** The direction a column sorts in on its first click: dates newest first, everything else A to Z. */
export function deriveFirstSortDir(key: SortColumn): SortDir {
  return NEWEST_FIRST.has(key) ? -1 : 1;
}

export interface TagCount { tag: string; count: number }

/** Case-insensitive: the first spelling wins; a paper counts once per tag. Sorted A to Z. */
export function countLibraryTags(papers: readonly Pick<PaperRecord, "tags">[]): TagCount[] {
  const found = new Map<string, TagCount>();
  for (const { tags } of papers) {
    for (const key of new Set((tags ?? []).map((t) => t.toLowerCase()))) {
      const entry = found.get(key);
      if (entry) entry.count++;
      else found.set(key, { tag: tags!.find((t) => t.toLowerCase() === key)!, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

export interface RelatedPapers {
  similar: Array<{ paper: PaperRecord; score: number }>;
  authors: PaperRecord[];
  /** Papers sharing tags or keywords, most shared first, with the shared terms. */
  shared: Array<{ paper: PaperRecord; common: string[] }>;
  venue: PaperRecord[];
  /** Distinct papers across every group. */
  total: number;
}

const newestFirst = (a: PaperRecord, b: PaperRecord): number => (b.year ?? 0) - (a.year ?? 0);
const venueOf = (p: PaperRecord): string => (p.journal ?? p.publisher ?? "").toLowerCase();

function sharedTerms(p: PaperRecord, others: PaperRecord[]): RelatedPapers["shared"] {
  const mine = new Set([...(p.tags ?? []), ...(p.keywords ?? [])].map((t) => t.toLowerCase()));
  return others
    .map((q) => {
      const seen = new Set<string>();
      const common = [...(q.tags ?? []), ...(q.keywords ?? [])].filter((t) => {
        const k = t.toLowerCase();
        if (!mine.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { paper: q, common };
    })
    .filter((x) => x.common.length > 0)
    .sort((a, b) => b.common.length - a.common.length);
}

export function deriveRelatedGroups(p: PaperRecord, library: readonly PaperRecord[], similar: readonly SimilarPaper[] = []): RelatedPapers {
  const others = library.filter((q) => q.id !== p.id);
  const byId = new Map(others.map((q) => [q.id, q]));
  const myAuthors = new Set((p.authors ?? []).filter((a) => a.trim()).map(normalizeAuthor));
  const authors = others.filter((q) => (q.authors ?? []).some((a) => myAuthors.has(normalizeAuthor(a)))).sort(newestFirst);
  const venue = venueOf(p) ? others.filter((q) => venueOf(q) === venueOf(p)).sort(newestFirst) : [];
  const shared = sharedTerms(p, others);
  const sim = similar.flatMap((s) => {
    const paper = byId.get(s.paperId);
    return paper ? [{ paper, score: s.score }] : [];
  });
  const ids = new Set([...authors, ...shared.map((x) => x.paper), ...venue, ...sim.map((x) => x.paper)].map((q) => q.id));
  return { similar: sim, authors, shared, venue, total: ids.size };
}

/** The parts of a keyboard event the keymap reads. */
export interface ShortcutPress {
  key: string;
  /** Physical key, so Alt+digit works on layouts where Alt changes the character. */
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type ListShortcutAction =
  | { kind: "focusSearch" }
  | { kind: "step"; delta: 1 | -1; extend: boolean }
  | { kind: "page"; dir: 1 | -1; extend: boolean }
  | { kind: "edge"; to: "first" | "last" }
  | { kind: "expand" }
  | { kind: "collapse" }
  | { kind: "parent" }
  | { kind: "open" }
  | { kind: "escape" }
  | { kind: "selectAll" }
  | { kind: "setStatus"; status: ReadingStatus }
  | { kind: "remove" }
  | { kind: "copyKeys" }
  | { kind: "menu" }
  | { kind: "typeToSearch" };

const STATUS_BY_CODE: Record<string, ReadingStatus> = { Digit1: "unread", Digit2: "reading", Digit3: "done" };

function modifiedAction(k: ShortcutPress, mod: boolean): ListShortcutAction | null {
  if (mod && k.key.toLowerCase() === "f") return { kind: "focusSearch" };
  if (mod && k.key.toLowerCase() === "a") return { kind: "selectAll" };
  if (mod && k.key.toLowerCase() === "c") return { kind: "copyKeys" };
  if (mod && k.key === "Backspace") return { kind: "remove" };
  const status = STATUS_BY_CODE[k.code];
  if (k.alt && !mod && status) return { kind: "setStatus", status };
  if (k.alt && k.key === "ArrowUp") return { kind: "parent" };
  if (k.key === "ContextMenu" || (k.shift && k.key === "F10")) return { kind: "menu" };
  return null;
}

/** The action a key press triggers in the list, or null when the list leaves the key alone. */
export function deriveListShortcutAction(k: ShortcutPress): ListShortcutAction | null {
  const mod = k.meta || k.ctrl;
  const modified = modifiedAction(k, mod);
  if (modified) return modified;
  switch (k.key) {
    case "/": return { kind: "focusSearch" };
    case "ArrowDown": return { kind: "step", delta: 1, extend: k.shift };
    case "ArrowUp": return { kind: "step", delta: -1, extend: k.shift };
    case "ArrowRight": return mod || k.alt ? null : { kind: "expand" };
    case "ArrowLeft": return mod || k.alt ? null : { kind: "collapse" };
    case "PageDown": return { kind: "page", dir: 1, extend: k.shift };
    case "PageUp": return { kind: "page", dir: -1, extend: k.shift };
    case "Home": return { kind: "edge", to: "first" };
    case "End": return { kind: "edge", to: "last" };
    case "Enter": return { kind: "open" };
    case "Escape": return { kind: "escape" };
    case "Delete": return { kind: "remove" };
  }
  return k.key.length === 1 && !mod && !k.alt ? { kind: "typeToSearch" } : null;
}
