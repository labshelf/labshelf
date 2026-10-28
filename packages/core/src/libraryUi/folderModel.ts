// Derives the folders and trees the sidebar shows: the library tree, the folder tree, folder rules, project rows, text-layer state and the open project's trees.
import { PAPERS_DIR, type FolderTreeNode, type LibrarySnapshot, findNode, checkFolderName } from "../library/index.js";
import type { PaperRecord, TextLayerDetails } from "../model/index.js";
import type { ProjectEntry } from "../writing/project/index.js";
import type { ReadingList } from "../writing/citations/index.js";
import type { TextLayerJobView } from "./protocol/index.js";
import type { IconName } from "../ui/index.js";

export type TreeChild =
  | { kind: "folder"; name: string; path: string; count: number }
  | { kind: "paper"; id: string; title: string };

export interface LibraryTree {
  /** The number of papers in the whole library. */
  total(): number;
  /** The subfolders of a folder with their recursive paper counts, then its own papers by title; computed on demand. */
  children(path: string): TreeChild[];
  /** The folder that holds a paper; undefined for an unknown id. */
  parentOf(id: string): string | undefined;
}

/** The fields the tree reads, so a host can send slim records. */
export type TreePaper = Pick<PaperRecord, "id" | "title" | "status" | "tags">;

const byTitle = (a: TreePaper, b: TreePaper): number => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

/**
 * Each paper's `folder` is keyed like `FolderTreeNode.path`: `PAPERS_DIR` for the root, `papers/A/B` below.
 * TRAP: the caller supplies it because `record.path` is absolute in a Node scan and relative in the browser.
 */
export function deriveLibraryTree(input: { folders: readonly FolderTreeNode[]; papers: readonly { record: TreePaper; folder: string }[] }): LibraryTree {
  // Indexed once: thousands of papers must not be scanned per expanded folder.
  const papersIn = new Map<string, TreePaper[]>();
  const folderOf = new Map<string, string>();
  input.papers.forEach(({ record, folder }) => {
    folderOf.set(record.id, folder);
    const list = papersIn.get(folder);
    if (list) list.push(record); else papersIn.set(folder, [record]);
  });
  const subfolders = new Map<string, readonly FolderTreeNode[]>([[PAPERS_DIR, input.folders]]);
  const counts = new Map<string, number>();
  const count = (node: FolderTreeNode): number => {
    subfolders.set(node.path, node.children);
    const total = (papersIn.get(node.path)?.length ?? 0) + node.children.reduce((sum, c) => sum + count(c), 0);
    counts.set(node.path, total);
    return total;
  };
  input.folders.forEach(count);

  return {
    total: () => input.papers.length,
    children: (path) => [
      ...(subfolders.get(path) ?? []).map((f): TreeChild => ({ kind: "folder", name: f.name, path: f.path, count: counts.get(f.path) ?? 0 })),
      ...[...(papersIn.get(path) ?? [])].sort(byTitle).map((p): TreeChild => ({ kind: "paper", id: p.id, title: p.title })),
    ],
    parentOf: (id) => folderOf.get(id),
  };
}

export interface CountedFolder extends FolderTreeNode {
  /** Papers in this folder and every folder below it. */
  total: number;
  children: CountedFolder[];
}

/** @returns the top-level folders with their sub-folders, in the snapshot's name order; paths start at papers */
export function deriveFolderTree(snapshot: LibrarySnapshot): CountedFolder[] {
  const build = (rels: readonly string[]): CountedFolder[] =>
    rels.flatMap((rel) => {
      const node = snapshot.collections.get(rel);
      return node ? [{ name: node.name, path: `${PAPERS_DIR}/${rel}`, total: node.total, children: build(node.children) }] : [];
    });
  return build(snapshot.collections.get("")?.children ?? []);
}

/** Every folder path in the tree, parents before children, labelled by the path below the root. */
export function listFolderPaths(tree: readonly FolderTreeNode[]): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = [];
  const walk = (nodes: readonly FolderTreeNode[]): void => {
    for (const n of nodes) { out.push({ label: n.path.slice(PAPERS_DIR.length + 1).split("/").join(" / "), path: n.path }); walk(n.children); }
  };
  walk(tree);
  return out;
}

interface FolderContext {
  folders: readonly FolderTreeNode[];
  papers: readonly PaperRecord[];
}

/** The core name rule plus a sibling collision check; `current` is the name being renamed, which stays allowed. */
export function checkSiblingFolderName(lib: FolderContext, parent: string, name: string, current?: string): string | null {
  const invalid = checkFolderName(name);
  if (invalid) return invalid;
  const trimmed = name.trim();
  if (trimmed === current) return null;
  const siblings = parent === PAPERS_DIR ? lib.folders : findNode(lib.folders, parent)?.children ?? [];
  if (siblings.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return `A folder named "${trimmed}" already exists here.`;
  if (lib.papers.some((p) => p.path === `${parent}/${trimmed}`)) return "A paper already uses that name here.";
  return null;
}

/** A writing project as the sidebar lists it; `id` is the host's opaque key (a folder path). */
export interface SidebarProject {
  id: string;
  name: string;
  /** Absent when the project's settings cannot be read. */
  format?: "latex" | "typst";
  /** Folder path inside My projects, segments joined by "/"; absent at the top level. */
  folder?: string;
  /** Archived or trashed: left out of the tree, listed only in the All projects tab. */
  hidden?: true;
  /** The project carries a share id, so this device joined or shared it. */
  shared?: true;
  /** Right-aligned text, like a folder's count. */
  count?: string;
  /** Multi-line `title` attribute. */
  tooltip: string;
}

/** A sidebar project plus what a host needs to offer the right menu. */
export interface SidebarProjectItem extends SidebarProject {
  kind: "ready" | "broken";
  external: boolean;
}

export type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;
export type BrokenEntry = Extract<ProjectEntry, { kind: "broken" }>;
export interface Counted { open: number; stale: number }
export interface LastBuild { ok: boolean; at: Date }

const pad = (value: number): string => String(value).padStart(2, "0");

function engineOf(entry: ReadyEntry): string {
  if (entry.settings.format === "typst") return "typst";
  return entry.settings.engine ?? "compiler not chosen";
}

/** One line per fact worth a glance; the reading and stale-figure lines appear only when they have something to say. */
export function describeProjectDetails(entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, reading: ReadingList): string[] {
  const lines = [`${entry.main ?? "no main file"} · ${engineOf(entry)}`];
  if (build) lines.push(`Last build ${build.ok ? "succeeded" : "failed"} ${pad(build.at.getHours())}:${pad(build.at.getMinutes())}`);
  const inLibrary = reading.entries.filter((candidate) => candidate.paper);
  if (inLibrary.length > 0) {
    lines.push(`Reading ${inLibrary.filter((candidate) => candidate.paper?.status === "done").length} of ${inLibrary.length}`);
  }
  if (counted && counted.stale > 0) lines.push(`${counted.stale} stale figures`);
  return lines;
}

/** `counted` and `build` are undefined when the host does not know them yet or cannot know them. */
export function createReadyProjectItem(
  entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, reading: ReadingList,
): SidebarProjectItem {
  const external = entry.location === "external";
  const tooltip = [entry.settings.id, ...describeProjectDetails(entry, counted, build, reading), ...(external ? [entry.folder] : [])];
  return {
    id: entry.folder,
    name: entry.settings.title ?? entry.settings.id,
    format: entry.settings.format,
    ...(entry.settings.folder ? { folder: entry.settings.folder } : {}),
    ...(entry.settings.archived || entry.settings.trashed ? { hidden: true as const } : {}),
    ...(entry.settings.shared ? { shared: true as const } : {}),
    ...(counted && counted.open > 0 ? { count: String(counted.open) } : {}),
    tooltip: tooltip.join("\n"),
    kind: "ready",
    external,
  };
}

export function createBrokenProjectItem(entry: BrokenEntry): SidebarProjectItem {
  return {
    id: entry.folder,
    name: entry.folder.split(/[\\/]/).pop() ?? entry.folder,
    count: "missing",
    tooltip: `${entry.folder}\n${entry.reason}`,
    kind: "broken",
    external: entry.location === "external",
  };
}

/** A paper whose PDF is a scan nobody has read yet, or whose OCR failed; a paper without a PDF never counts. */
export function hasMissingTextLayer(p: { hasPdf: boolean; textLayer?: TextLayerDetails | undefined }): boolean {
  const state = p.textLayer?.state;
  return p.hasPdf && (state === "missing" || state === "failed");
}

export function describeTextLayerJob(job: TextLayerJobView): string {
  return job.phase === "reading"
    ? `Making searchable — reading page ${job.page ?? 1} of ${job.total ?? 1}…`
    : "Waiting to be made searchable…";
}

/** Pages already read, out of all the pages to read, in percent. */
export function deriveJobProgress(job: TextLayerJobView): number {
  return job.phase === "reading" && job.total ? Math.round((100 * ((job.page ?? 1) - 1)) / job.total) : 0;
}

/** @returns the File section's "Text" line */
export function describeTextLayer(p: { hasPdf: boolean; textLayer?: TextLayerDetails | undefined }, job: TextLayerJobView | undefined): string {
  if (job) return describeTextLayerJob(job);
  if (!p.hasPdf) return "No PDF";
  const tl = p.textLayer;
  if (!tl) return "Not checked yet";
  if (tl.state === "native") return "Embedded in the PDF";
  if (tl.state === "ocr") {
    const pages = tl.ocrPages ? ` · ${tl.ocrPages} page${tl.ocrPages === 1 ? "" : "s"}` : "";
    return `Added by OCR${pages}${tl.failedPages ? `, ${tl.failedPages} unreadable` : ""}`;
  }
  return tl.state === "failed" ? "None (OCR failed)" : "None";
}

export type ProjectTreeView = "files" | "outline" | "checklist";

const PROJECT_TREE_VIEWS: readonly unknown[] = ["files", "outline", "checklist"] satisfies ProjectTreeView[];

export const isProjectTreeView = (view: unknown): view is ProjectTreeView => PROJECT_TREE_VIEWS.includes(view);

export type SidebarNodeIcon =
  | { kind: "glyph"; name: IconName }
  /** A short file-type label in the icon column, like a paper's REF. */
  | { kind: "label"; text: string; tone: FileLabelKind }
  /** A small filled dot whose colour says how the row stands. */
  | { kind: "dot"; tone: DotKind };

/** err: an error; warn: a warning; accent: in progress; ok: done; muted: open or neutral. */
export type DotKind = "err" | "warn" | "accent" | "ok" | "muted";

export type FileLabelKind = "tex" | "typ" | "pdf" | "ref" | "plain";

export interface SidebarTreeNode {
  /** Unique within its view and stable across refreshes, so expansion survives them. */
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: SidebarNodeIcon;
  /** Present for a node that folds; empty when it has no rows yet. */
  children?: SidebarTreeNode[];
  /** Whether a folding node starts open. */
  open?: boolean;
  /** Present for a node with a checkbox. */
  checked?: boolean;
  /** A click runs the node's command instead of folding it. */
  clickable?: boolean;
  menu?: Array<{ label: string; action: string; danger?: boolean }>;
  /** A mark at the row's right edge with its own click, e.g. a paper's status. */
  trailing?: { icon: SidebarNodeIcon; tooltip: string; action: string };
  /** Drawn faded, e.g. the "12 read" subgroup. */
  dim?: boolean;
  /** Text struck through, e.g. a done manual item. */
  struck?: boolean;
  /** A small text button on the row, e.g. "Regenerate". */
  inlineAction?: { action: string; label: string };
  /** A hover "+" opens an inline input under the row; its text goes to the host as an add request. */
  addable?: { placeholder: string };
}

export interface SidebarTreeAction {
  action: string;
  label: string;
  icon: IconName;
}

export interface SidebarProjectTree {
  view: ProjectTreeView;
  title: string;
  actions: SidebarTreeAction[];
  /** An always-visible two-option toggle, the first row of the pane, e.g. By kind | By section. */
  toggle?: { options: Array<{ action: string; label: string }>; selected: string };
  nodes: SidebarTreeNode[];
  /** Shown when `nodes` is empty. */
  empty: string;
}

/** The project open in the window; `id` is the host's key, as in the project list. */
export interface SidebarOpenProject {
  id: string;
  name: string;
  format?: "latex" | "typst";
  trees: SidebarProjectTree[];
}

const FILE_LABELS: Record<string, [string, FileLabelKind]> = {
  tex: ["TEX", "tex"], sty: ["STY", "tex"], cls: ["CLS", "tex"], typ: ["TYP", "typ"],
  pdf: ["PDF", "pdf"], bib: ["BIB", "ref"], md: ["MD", "plain"], json: ["{}", "plain"], yaml: ["YML", "plain"], yml: ["YML", "plain"],
};

/** A file's icon: its type label when it has one, else the plain file glyph. */
export function deriveFileIcon(name: string): SidebarNodeIcon {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const label = FILE_LABELS[ext];
  return label ? { kind: "label", text: label[0], tone: label[1] } : { kind: "glyph", name: "file" };
}
