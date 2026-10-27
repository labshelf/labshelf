// Derives what Spaces screens show from a Space, the Library and the projects: papers tree, catalog and sidebar rows, checklist progress.
import type { PaperRecord } from "../model/index.js";
import type { ReadingStatus } from "../library/index.js";
import { buildChecklist, type ChecklistSignals, type ReadingItem } from "../writing/index.js";
import type { Space, SpaceDateKind, SpaceReadResult } from "./model/index.js";

/** A writing project as the host reports it; supplied by the host port. */
export interface SpaceProjectEntry {
  readonly projectId: string;
  readonly title: string;
  readonly format?: string;
  readonly mainFile?: string;
  /** YYYY-MM-DD */
  readonly deadline?: string;
  readonly checklist?: { readonly done: number; readonly total: number };
  readonly available: boolean;
}

export interface Progress { readonly done: number; readonly total: number }

export type ResolvedPaper =
  | {
    readonly id: string;
    readonly missing: false;
    readonly title: string;
    readonly authors: readonly string[];
    readonly year?: number;
    readonly status: ReadingStatus;
  }
  | { readonly id: string; readonly missing: true };

export interface TimelineEntry {
  readonly id: string;
  readonly kind: SpaceDateKind;
  readonly title: string;
  readonly date: string;
  readonly when: "past" | "today" | "future";
  /** Calendar days from today; negative in the past. */
  readonly daysAway: number;
  /** Past, a task, not done. */
  readonly overdue: boolean;
  readonly done?: boolean;
  readonly progress?: Progress;
  /** Set on deadlines taken from a linked project. */
  readonly fromProject?: true;
}

export interface SpaceOverview {
  readonly timeline: readonly TimelineEntry[];
  readonly focus: readonly ResolvedPaper[];
  readonly projects: readonly SpaceProjectEntry[];
}

export interface PapersTreeFolder {
  readonly id: string;
  readonly name: string;
  readonly folders: readonly PapersTreeFolder[];
  readonly papers: readonly ResolvedPaper[];
}

export interface PapersTree {
  readonly folders: readonly PapersTreeFolder[];
  readonly papers: readonly ResolvedPaper[];
}

export interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly purpose?: string;
  readonly reading: Progress;
  readonly next: { readonly date: string; readonly title: string } | null;
  readonly counts: { readonly papers: number; readonly projects: number };
  readonly shared: false;
  /** The reason the Space cannot be read. */
  readonly unreadable?: string;
}

export type SidebarRow =
  | { readonly id: string; readonly name: string; readonly tree: PapersTree }
  | { readonly id: string; readonly name: string; readonly unreadable: string };

/** The part of a Library snapshot the views read. */
export type LibraryPapers = ReadonlyMap<string, { readonly record: PaperRecord }>;

export function resolvePaper(id: string, library: LibraryPapers): ResolvedPaper {
  const record = library.get(id)?.record;
  if (!record) return { id, missing: true };
  const base = { id, missing: false as const, title: record.title, authors: record.authors ?? [], status: record.status };
  return record.year === undefined ? base : { ...base, year: record.year };
}

export function buildPapersTree(space: Space, library: LibraryPapers): PapersTree {
  const ids = new Set(space.folders.map((f) => f.id));
  // A folder whose parent is missing sits at the root, as the reader already does for the file.
  const parentOf = (f: { parent?: string | undefined }): string | undefined => (f.parent !== undefined && ids.has(f.parent) ? f.parent : undefined);
  const papersIn = (folder: string | undefined) =>
    space.papers.filter((p) => (p.folder !== undefined && ids.has(p.folder) ? p.folder : undefined) === folder).map((p) => resolvePaper(p.id, library));
  const foldersIn = (parent: string | undefined, seen: ReadonlySet<string>): PapersTreeFolder[] =>
    space.folders.filter((f) => parentOf(f) === parent && !seen.has(f.id)).map((f) => ({
      id: f.id,
      name: f.name,
      folders: foldersIn(f.id, new Set([...seen, f.id])),
      papers: papersIn(f.id),
    }));
  return { folders: foldersIn(undefined, new Set()), papers: papersIn(undefined) };
}

export interface CatalogFilter {
  readonly text: string;
  readonly scope: "all" | "personal" | "shared";
}

/** The earliest date on or after today that is not a finished task. */
function nextOpenDate(space: Space, today: string): CatalogRow["next"] {
  const open = space.dates
    .filter((d) => d.date >= today && !(d.kind === "task" && d.done))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return open ? { date: open.date, title: open.title } : null;
}

function readyRow(space: Space, library: LibraryPapers, today: string): CatalogRow {
  const done = space.papers.filter((p) => {
    const paper = resolvePaper(p.id, library);
    return !paper.missing && paper.status === "done";
  }).length;
  return {
    id: space.id,
    name: space.name,
    ...(space.purpose === undefined ? {} : { purpose: space.purpose }),
    reading: { done, total: space.papers.length },
    next: nextOpenDate(space, today),
    counts: { papers: space.papers.length, projects: space.projects.length },
    shared: false,
  };
}

export function deriveCatalogRows(results: readonly SpaceReadResult<unknown>[], library: LibraryPapers, today: string): CatalogRow[] {
  return results.map((r) =>
    r.state === "ready"
      ? readyRow(r.space, library, today)
      : { id: r.id, name: r.id, reading: { done: 0, total: 0 }, next: null, counts: { papers: 0, projects: 0 }, shared: false, unreadable: r.reason });
}

/** Shared Spaces do not exist yet, so the Shared scope is empty. */
export function deriveFilteredCatalogRows(rows: readonly CatalogRow[], filter: CatalogFilter): CatalogRow[] {
  if (filter.scope === "shared") return [];
  const needle = filter.text.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => `${r.name}\n${r.purpose ?? ""}`.toLowerCase().includes(needle));
}

export function deriveSidebarRows(results: readonly SpaceReadResult<unknown>[], library: LibraryPapers): SidebarRow[] {
  return results.map((r) =>
    r.state === "ready"
      ? { id: r.space.id, name: r.space.name, tree: buildPapersTree(r.space, library) }
      : { id: r.id, name: r.id, unreadable: r.reason });
}

export function deriveSpaceChecklistProgress(signals: ChecklistSignals, reading: readonly ReadingItem[]): Progress {
  const checklist = buildChecklist({
    ...signals, reading, pageOverflow: undefined,
    placeSection: file => ({ id: file, title: file, file }), citeSections: new Map(),
  }, "kind");
  const items = checklist.groups.flatMap(group => group.items);
  return { done: items.filter(item => item.done).length, total: items.length };
}
