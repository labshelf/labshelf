// Derives what Spaces screens show from a Space, the Library and the projects: papers tree, catalog and sidebar rows, checklist progress.
import type { PaperRecord } from "../model/index.js";
import type { ReadingStatus } from "../library/index.js";
import { buildChecklist, type ChecklistSignals, type ReadingItem } from "../writing/index.js";
import type { ThreadStatus } from "./spaceDiscussionsStore.js";
import { placeOfSpace, readPaperInfo, type Space, type SpaceReference, type SpaceDateKind, type SpacePlace, type SpaceReadResult } from "./space.js";

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
  /** The project is shared, so it has a Project chat (`.labshelf/chat.qmd`) the Space's Discussions list. */
  readonly hasChat?: boolean;
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
  | { readonly id: string; readonly missing: true; readonly remote?: RemotePaper };

/** What the Space's members wrote about a paper this library lacks (`info` of its reference). */
export interface RemotePaper {
  readonly title: string;
  readonly authors: readonly string[];
  readonly year?: number;
  /** True whenever the reference has `info`: a paper without a PDF downloads as its metadata. */
  readonly downloadable: boolean;
  /** True when the `info` names a PDF to fetch from the peers. */
  readonly hasPdf: boolean;
}

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

/** One qmd item shown on a desk card: its body and who wrote it when. */
interface DeskExcerpt {
  readonly body: string;
  readonly author?: string;
  readonly created?: string;
}

/** What a desk card shows; a note or topic whose file is gone is `missing`. */
export type DeskCard =
  | { readonly kind: "paper"; readonly ref: string; readonly paper: ResolvedPaper }
  | { readonly kind: "project"; readonly ref: string; readonly project: SpaceProjectEntry }
  | { readonly kind: "note" | "thread"; readonly ref: string; readonly missing: true }
  | { readonly kind: "note"; readonly ref: string; readonly missing: false; readonly title: string; readonly body: string; readonly updated: string }
  | {
    readonly kind: "thread"; readonly ref: string; readonly missing: false; readonly title: string; readonly status: ThreadStatus;
    /** The topic text without its `# title` line. */
    readonly topic: string;
    readonly replies: number;
    readonly last?: DeskExcerpt;
  };

export interface SpaceOverview {
  readonly timeline: readonly TimelineEntry[];
  readonly desk: readonly DeskCard[];
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
  /** The Space's Tabler icon; absent shows the layers icon. */
  readonly icon?: string;
  readonly reading: Progress;
  readonly next: { readonly date: string; readonly title: string } | null;
  readonly counts: { readonly papers: number; readonly projects: number };
  readonly place: SpacePlace;
  /** When the Space was moved to Trash; set only in Trash. */
  readonly trashedAt?: string;
  /** The reason the Space cannot be read. */
  readonly unreadable?: string;
}

export type SidebarRow =
  /** `icon` is the Space's Tabler icon; absent shows the layers icon. */
  | { readonly id: string; readonly name: string; readonly icon?: string; readonly tree: PapersTree }
  | { readonly id: string; readonly name: string; readonly unreadable: string };

/** The part of a Library snapshot the views read. */
export type LibraryPapers = ReadonlyMap<string, { readonly record: PaperRecord }>;

function remoteOf(reference: Pick<SpaceReference, "extra"> | undefined): RemotePaper | undefined {
  const info = reference ? readPaperInfo(reference) : undefined;
  if (!info) { return undefined; }
  return {
    title: info.title, authors: info.authors ?? [], ...(info.year === undefined ? {} : { year: info.year }),
    downloadable: true, hasPdf: info.pdf !== undefined,
  };
}

/** `reference` is the Space's reference to the paper; a missing paper shows what its `info` says. */
export function resolvePaper(id: string, library: LibraryPapers, reference?: Pick<SpaceReference, "extra">): ResolvedPaper {
  const record = library.get(id)?.record;
  // A paper in the in-app Trash is out of the library until restored.
  if (!record || record.trashedAt) {
    const remote = remoteOf(reference);
    return remote ? { id, missing: true, remote } : { id, missing: true };
  }
  const base = { id, missing: false as const, title: record.title, authors: record.authors ?? [], status: record.status };
  return record.year === undefined ? base : { ...base, year: record.year };
}

export function buildPapersTree(space: Space, library: LibraryPapers): PapersTree {
  const ids = new Set(space.folders.map((f) => f.id));
  // A folder whose parent is missing sits at the root, as the reader already does for the file.
  const parentOf = (f: { parent?: string | undefined }): string | undefined => (f.parent !== undefined && ids.has(f.parent) ? f.parent : undefined);
  const papersIn = (folder: string | undefined) =>
    space.papers.filter((p) => (p.folder !== undefined && ids.has(p.folder) ? p.folder : undefined) === folder).map((p) => resolvePaper(p.id, library, p));
  const foldersIn = (parent: string | undefined, seen: ReadonlySet<string>): PapersTreeFolder[] =>
    space.folders.filter((f) => parentOf(f) === parent && !seen.has(f.id)).map((f) => ({
      id: f.id,
      name: f.name,
      folders: foldersIn(f.id, new Set([...seen, f.id])),
      papers: papersIn(f.id),
    }));
  return { folders: foldersIn(undefined, new Set()), papers: papersIn(undefined) };
}

/** True when the folder or Space, subfolders included, holds a missing paper the page can offer to download. */
export function hasDownloadablePapers(node: { readonly papers: readonly ResolvedPaper[]; readonly folders: readonly PapersTreeFolder[] }): boolean {
  return node.papers.some((p) => p.missing && p.remote?.downloadable === true) || node.folders.some(hasDownloadablePapers);
}

export interface CatalogFilter {
  readonly text: string;
  readonly place: SpacePlace;
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
    ...(space.icon === undefined ? {} : { icon: space.icon }),
    reading: { done, total: space.papers.length },
    next: nextOpenDate(space, today),
    counts: { papers: space.papers.length, projects: space.projects.length },
    place: placeOfSpace(space),
    ...(space.trashedAt === undefined ? {} : { trashedAt: space.trashedAt }),
  };
}

export function deriveCatalogRows(results: readonly SpaceReadResult<unknown>[], library: LibraryPapers, today: string): CatalogRow[] {
  return results.map((r) =>
    r.state === "ready"
      ? readyRow(r.space, library, today)
      : { id: r.id, name: r.id, reading: { done: 0, total: 0 }, next: null, counts: { papers: 0, projects: 0 }, place: "spaces", unreadable: r.reason });
}

/** The rows of one place matching the text; Trash rows come newest trashed first. */
export function deriveFilteredCatalogRows(rows: readonly CatalogRow[], filter: CatalogFilter): CatalogRow[] {
  const needle = filter.text.trim().toLowerCase();
  const matching = rows.filter((r) => r.place === filter.place && (!needle || `${r.name}\n${r.purpose ?? ""}`.toLowerCase().includes(needle)));
  return filter.place === "trash" ? matching.sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? "")) : matching;
}

export function countCatalogPlaces(rows: readonly CatalogRow[]): Record<SpacePlace, number> {
  const counts: Record<SpacePlace, number> = { spaces: 0, archived: 0, trash: 0 };
  for (const row of rows) { counts[row.place] += 1; }
  return counts;
}

/** Only Spaces in the Spaces place; unreadable Spaces stay so they can be fixed. */
export function deriveSidebarRows(results: readonly SpaceReadResult<unknown>[], library: LibraryPapers): SidebarRow[] {
  return results.filter((r) => r.state !== "ready" || placeOfSpace(r.space) === "spaces").map((r) =>
    r.state === "ready"
      ? { id: r.space.id, name: r.space.name, ...(r.space.icon === undefined ? {} : { icon: r.space.icon }), tree: buildPapersTree(r.space, library) }
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
