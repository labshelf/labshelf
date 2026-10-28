// Models the All projects page: its rows, detail pane, storage port, view state and derived groups, and the deadline text.
import type { ProjectFormat, ProjectSubmission } from "../project/index.js";

/** The page keeps each place apart: archived and trashed projects never mix with the others. */
export type ProjectPlace = "projects" | "archived" | "trash";

/** `earlier` is a PDF from before this session (`at` is its mtime); `never` is no PDF and no outcome. */
export type ProjectBuildState = "ok" | "warnings" | "failed" | "building" | "earlier" | "never";

export interface BuildMark {
  state: ProjectBuildState;
  /** Epoch ms of the outcome, or of the PDF for `earlier`. */
  at?: number;
}

export type CreateProjectKind = "blank" | "template" | "folder";

export interface ProjectRow {
  /** The project's key: its folder. */
  id: string;
  title: string;
  /** Absent when the project's labshelf.yaml cannot be read. */
  format?: ProjectFormat;
  /** Sidebar folder, segments joined by "/"; absent at the top level. */
  folder?: string;
  place: ProjectPlace;
  /** Epoch ms of the newest source file. */
  modified?: number;
  /** ISO time the project went to the trash. */
  trashedAt?: string;
  /** Distinct keys the project cites. */
  cites?: number;
  /** Cited keys found neither in the library nor in the project's bibliography. */
  unresolvedCites?: number;
  build?: BuildMark;
  target?: ProjectSubmission;
  /** The project lives outside the library, so deleting it forever only removes it from LabShelf. */
  external?: boolean;
  /** Why the project cannot be read. */
  broken?: string;
  /** The project carries a share id, so this device joined or shared it. */
  shared?: boolean;
  /** The main file, relative to the project folder and "/"-separated. */
  main?: string;
}

/** A host-specific action on a project row, such as "Reveal in Finder". */
export interface ProjectMenuCommand {
  command: string;
  label: string;
  /** Rows of the same group sit together between separators. */
  group: number;
  externalOnly?: boolean;
}

export interface ProjectBuildReport extends BuildMark {
  warnings: number;
  errors: number;
  /** The first problem the last build reported. */
  first?: { message: string; file?: string; line?: number };
}

/** A count against its limit; `limit` is absent when the project sets none. */
export interface CountedLimit {
  counted: number;
  limit?: number;
}

export interface ProjectCitation {
  key: string;
  /** Where the key resolves: a library paper, an entry of the project's bibliography, or nowhere. */
  source: "library" | "bib" | "none";
  paperId?: string;
  title?: string;
  authors?: string;
  year?: string;
}

export interface ProjectPaneContent {
  id: string;
  /** Absolute project folder. */
  location: string;
  /** The LaTeX engine, or "Typst <version>". */
  engine?: string;
  /** Pages of the last PDF. */
  pages?: number;
  limits: { countUpTo: "references" | "end"; pages?: CountedLimit; words?: CountedLimit };
  build: ProjectBuildReport;
  /** Name of the last LaTeX log file when it exists, such as "main.log". */
  log?: string;
  bibliography?: { file: string; entries: number; generated: boolean; written?: number };
  /** In key order. */
  citations: ProjectCitation[];
  /** Newest first. */
  versions: { name: string; created: string }[];
  /** Project-relative includes, main first. */
  sources: string[];
}

/** Every `id` is a ProjectRow id; the implementation binds the logger and the library. */
export interface ProjectLibraryPort {
  list(): Promise<ProjectRow[]>;
  /** Returns the function that stops listening. */
  onDidChange(listener: () => void): () => void;
  commands(): ProjectMenuCommand[];
  open(id: string): Promise<void>;
  /** The kinds `create` can make on this host; the page offers only these. */
  newKinds(): CreateProjectKind[];
  create(kind: CreateProjectKind): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  duplicate(id: string, title: string): Promise<void>;
  move(id: string, folder: string | undefined): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  setTrashed(id: string, trashed: boolean): Promise<void>;
  /** Deletes a library project's folder; an external project is only removed from LabShelf. */
  deleteForever(id: string): Promise<void>;
  runCommand(id: string, command: string): Promise<void>;
  /** Every file of the project, relative to its folder, "/"-separated and sorted. */
  files(id: string): Promise<string[]>;
  /** Opens one of `files(id)`, opening the project first when another one is open. */
  openFile(id: string, path: string): Promise<void>;
  detail(id: string): Promise<ProjectPaneContent>;
  build(id: string): Promise<void>;
  /** Opens the project's last PDF. */
  preview(id: string): Promise<void>;
  /** Opens the last LaTeX log. */
  openLog(id: string): Promise<void>;
  /** Creates an empty file at a project-relative `path`, then opens it. */
  createFile(id: string, path: string): Promise<void>;
  /** Writes the project's `target` to labshelf.yaml; `null` removes it. */
  setTarget(id: string, target: ProjectSubmission | null): Promise<void>;
  /** The host's name for opening a project in its editor, such as "Open in VS Code". */
  openLabel(): string;
}

export type ProjectSortField = "title" | "cites" | "modified";

export interface ProjectViewState {
  place: ProjectPlace;
  query: string;
  sort: { key: ProjectSortField; dir: "asc" | "desc" };
}

export const DEFAULT_PROJECT_VIEW: ProjectViewState = { place: "projects", query: "", sort: { key: "modified", dir: "desc" } };

/** Numbers start with the biggest (newest, most cited), titles with A. */
export function deriveFirstProjectSortDir(key: ProjectSortField): "asc" | "desc" {
  return key === "title" ? "asc" : "desc";
}

export interface ProjectGroup {
  /** The folder path; "" for top-level rows. */
  key: string;
  segments: string[];
  rows: ProjectRow[];
}

const compareText = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

function matchesQuery(row: ProjectRow, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${row.title}\n${row.folder ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** In the trash, "modified" orders by the time the project went to the trash, which is the date the page shows there. */
function sortValue(row: ProjectRow, key: Exclude<ProjectSortField, "title">): number | undefined {
  if (key === "modified" && row.place === "trash") { return row.trashedAt ? Date.parse(row.trashedAt) : undefined; }
  return row[key];
}

function compareRows(sort: ProjectViewState["sort"]): (a: ProjectRow, b: ProjectRow) => number {
  const sign = sort.dir === "asc" ? 1 : -1;
  return (a, b) => {
    if (sort.key !== "title") {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      // Missing values sort last in both directions.
      if (x === undefined && y !== undefined) { return 1; }
      if (y === undefined && x !== undefined) { return -1; }
      if (x !== undefined && y !== undefined && x !== y) { return (x - y) * sign; }
      return compareText(a.title, b.title);
    }
    return compareText(a.title, b.title) * sign;
  };
}

function groupByFolder(rows: ProjectRow[]): ProjectGroup[] {
  const byFolder = new Map<string, ProjectRow[]>();
  for (const row of rows) {
    const key = row.folder ?? "";
    byFolder.set(key, [...(byFolder.get(key) ?? []), row]);
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : compareText(a, b)))
    .map(([key, groupRows]) => ({ key, segments: key === "" ? [] : key.split("/"), rows: groupRows }));
}

export function deriveProjectView(rows: readonly ProjectRow[], state: ProjectViewState): ProjectGroup[] {
  const shown = rows
    .filter((row) => row.place === state.place && matchesQuery(row, state.query))
    .sort(compareRows(state.sort));
  if (state.place !== "projects") { return [{ key: "", segments: [], rows: shown }]; }
  return groupByFolder(shown);
}

export function countPlaces(rows: readonly ProjectRow[]): Record<ProjectPlace, number> {
  const counts: Record<ProjectPlace, number> = { projects: 0, archived: 0, trash: 0 };
  for (const row of rows) { counts[row.place] += 1; }
  return counts;
}

/** Existing folder paths in every place, for the "Move to folder" picker. */
export function listMoveFolders(rows: readonly ProjectRow[]): string[] {
  const folders = new Set<string>();
  for (const row of rows) { if (row.folder) { folders.add(row.folder); } }
  return [...folders].sort(compareText);
}

export interface DeadlineText {
  text: string;
  tone: "normal" | "near" | "passed";
}

const DAY_MS = 86_400_000;
const NEAR_DAYS = 14;

/** Calendar days from today to the deadline in the reader's time zone, negative once it has passed; undefined without a valid date. */
export function countDaysUntil(target: ProjectSubmission | undefined, now: number): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target?.deadline ?? "");
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const due = Date.UTC(year, month - 1, day);
  if (new Date(due).getUTCDate() !== day) return undefined;
  const today = new Date(now);
  // UTC arithmetic on both dates keeps daylight-saving shifts out of the difference.
  return Math.round((due - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
}

/** A deadline stays "0 d" until midnight. */
export function formatDeadlineText(target: ProjectSubmission | undefined, now: number): DeadlineText | undefined {
  const days = countDaysUntil(target, now);
  if (days === undefined) return undefined;
  if (days < 0) return { text: "passed", tone: "passed" };
  return { text: `${days} d`, tone: days <= NEAR_DAYS ? "near" : "normal" };
}
