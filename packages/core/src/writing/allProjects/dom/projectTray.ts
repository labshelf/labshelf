// Builds the expanded project's tray: file tree rows, log and Add file rows, tray facts, and the expansion state that posts their requests.
import { askInputBox } from "../../../ui/dom/index.js";
import { buildFailedRow, buildLoadingRow, buildTrayRow, type TrayEntry } from "../../../libraryUi/dom/index.js";
import { formatCompactTime } from "../../../time/index.js";
import { formatCount, renderIcon } from "../../../ui/index.js";
import type { ProjectPaneContent, ProjectRow } from "../projectModel.js";
import type { AllProjectsToHost, HostToAllProjects } from "../protocol.js";

interface FileTreeEntry {
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

const MAX_CONTENTS = 4;

const toneOf = (ext: string): TrayEntry["tone"] => ext === "pdf" ? "pdf" : ext === "md" ? "md" : "other";
const trayStem = (path: string): string => /([^/]*?)(\.[^./]*)?$/.exec(path)?.[1] ?? path;

// The build outcome only counts problems when a build ran in this session.
const hasOutcome = (d: ProjectPaneContent): boolean => d.build.state === "ok" || d.build.state === "warnings" || d.build.state === "failed";

function outcome(d: ProjectPaneContent): string[] {
  return hasOutcome(d) ? [formatCount(d.build.warnings, "warning"), formatCount(d.build.errors, "error")] : [];
}

function mainFact(d: ProjectPaneContent): string {
  const first = d.build.first;
  const where = first?.file ? ` in ${first.file}${first.line !== undefined ? `:${first.line}` : ""}` : "";
  const problems = hasOutcome(d) ? [d.build.warnings > 0 && formatCount(d.build.warnings, "warning"), d.build.errors > 0 && formatCount(d.build.errors, "error")] : [];
  return [d.pages !== undefined && formatCount(d.pages, "page"), ...problems, first && first.message + where].filter(Boolean).join(" · ");
}

/** The bibliography sentence the tray and the Overview tab share. */
export function deriveBibliographyFact(bib: NonNullable<ProjectPaneContent["bibliography"]>, now = Date.now()): string {
  const entries = `${bib.entries} ${bib.entries === 1 ? "entry" : "entries"}`;
  if (!bib.generated) return entries;
  return `${entries} written from the library${bib.written !== undefined ? ` · synced ${formatCompactTime(bib.written, now)} ago` : ""}`;
}

function contentsFact(folder: string, sources: readonly string[]): string | null {
  const inside = sources.filter((s) => s.startsWith(`${folder}/`)).map(trayStem);
  if (inside.length === 0) return null;
  const names = [...new Set(inside)];
  return names.slice(0, MAX_CONTENTS).join(", ") + (names.length > MAX_CONTENTS ? ", …" : "");
}

function factOf(f: FileTreeEntry, row: ProjectRow, detail: ProjectPaneContent | undefined): TrayEntry["fact"] {
  if (f.path === row.main) return { label: "Main", text: detail ? mainFact(detail) : "" };
  if (!detail) return null;
  if (f.folder) {
    const text = contentsFact(f.path, detail.sources);
    return text ? { label: "Contents", text } : null;
  }
  return detail.bibliography?.file === f.path ? { label: "Bibliography", text: deriveBibliographyFact(detail.bibliography) } : null;
}

/** The row for one file or folder of the tree; the fact fills in once the detail arrives. */
function createProjectFileEntry(f: FileTreeEntry, row: ProjectRow, detail: ProjectPaneContent | undefined): TrayEntry {
  if (f.folder) return { kind: "folder", name: f.name, type: "", tone: "dir", fact: factOf(f, row, detail), title: f.path };
  const ext = /\.([^.]+)$/.exec(f.name)?.[1]?.toLowerCase() ?? "";
  return { kind: "file", name: f.name, type: ext.slice(0, 4).toUpperCase(), tone: toneOf(ext), fact: factOf(f, row, detail), title: f.path };
}

/** The last build's log; absent until the detail says one exists. */
function createProjectLogEntry(detail: ProjectPaneContent | undefined): TrayEntry | null {
  if (!detail?.log) return null;
  const text = [...outcome(detail), detail.pages !== undefined && formatCount(detail.pages, "page")].filter(Boolean).join(", ");
  return { kind: "file", name: detail.log, type: "LOG", tone: "other", fact: { label: "Last build", text }, title: detail.log };
}

/** Its type cell holds an add icon instead of a type label. */
const ADD_FILE_ENTRY: TrayEntry = { kind: "file", name: "+ Add file", type: "", tone: "other", fact: null, title: "Add file" };

type ProjectFiles = { status: "loading" } | { status: "ready"; files: string[] } | { status: "failed"; message: string };

export interface ProjectTrayFrame {
  expanded: string | null;
  files: Readonly<Record<string, ProjectFiles>>;
  /** The expanded project's last detail; the tray shows names and the Main role without it. */
  detail: ProjectPaneContent | undefined;
  /** Keys come from `openFolderKey`. */
  openFolders: ReadonlySet<string>;
}

export interface ProjectTrayHandlers {
  onOpenFile: (id: string, path: string) => void;
  onToggleFolder: (id: string, path: string) => void;
  onOpenLog: (id: string) => void;
  onAddFile: (id: string) => void;
}

const openFolderKey = (id: string, path: string): string => `${id}\n${path}`;

/** One tray row; `name` is unique within the tray and `depth` counts folders below the project. */
export interface ProjectTrayRow {
  name: string;
  depth: number;
  node: HTMLElement;
}

const trayRow = (node: HTMLElement, depth = 0): ProjectTrayRow => ({ name: node.dataset["name"]!, depth, node });

function fileRows(row: ProjectRow, files: string[], detail: ProjectPaneContent | undefined, open: ReadonlySet<string>, h: ProjectTrayHandlers): ProjectTrayRow[] {
  return deriveProjectFileTree(files, open).map((f) => {
    const r = buildTrayRow(createProjectFileEntry(f, row, detail), () => (f.folder ? h.onToggleFolder : h.onOpenFile)(row.id, f.path));
    // Rows are keyed by name, and names repeat across folders.
    r.dataset["name"] = f.path;
    r.style.setProperty("--depth", String(f.depth));
    if (f.folder) { r.setAttribute("aria-expanded", String(f.open)); r.classList.toggle("open", f.open); }
    return trayRow(r, f.depth);
  });
}

// A trashed project only lists its files, so it offers neither the log nor a new file.
function actionRows(row: ProjectRow, detail: ProjectPaneContent | undefined, h: ProjectTrayHandlers): ProjectTrayRow[] {
  if (row.place === "trash") return [];
  const out: ProjectTrayRow[] = [];
  const log = createProjectLogEntry(detail);
  if (log) {
    const r = buildTrayRow(log, () => h.onOpenLog(row.id));
    r.dataset["name"] = ":log";
    out.push(trayRow(r));
  }
  const add = buildTrayRow(ADD_FILE_ENTRY, () => h.onAddFile(row.id));
  add.dataset["name"] = ":add";
  add.querySelector(".file-type")!.innerHTML = renderIcon("plus");
  return [...out, trayRow(add)];
}

function stateRow(node: HTMLElement, name: string): ProjectTrayRow {
  node.dataset["name"] = name;
  return trayRow(node);
}

function trayRows(row: ProjectRow, state: ProjectFiles | undefined, detail: ProjectPaneContent | undefined, open: ReadonlySet<string>, h: ProjectTrayHandlers): ProjectTrayRow[] {
  if (!state || state.status === "loading") return [stateRow(buildLoadingRow(), ":loading")];
  if (state.status === "failed") return [stateRow(buildFailedRow(state.message), ":failed")];
  // The log has its own row, so the tree leaves it out.
  const files = row.place === "trash" || !detail?.log ? state.files : state.files.filter((p) => p !== detail.log);
  return [...fileRows(row, files, detail, open, h), ...actionRows(row, detail, h)];
}

function openFoldersOf(id: string, frame: ProjectTrayFrame): Set<string> {
  const prefix = openFolderKey(id, "");
  return new Set([...frame.openFolders].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}

/** Builds the expanded project's rows; a call with the same inputs as the last returns the same nodes, so focus and hover survive. */
export function createProjectTrayRows(h: ProjectTrayHandlers): (row: ProjectRow, frame: ProjectTrayFrame) => ProjectTrayRow[] {
  let last: { inputs: unknown[]; rows: ProjectTrayRow[] } | null = null;
  return (row, frame) => {
    const open = openFoldersOf(row.id, frame);
    const inputs = [row, frame.files[row.id], frame.detail, [...open].sort().join("\n")];
    if (last && inputs.every((v, i) => v === last!.inputs[i])) return last.rows;
    last = { inputs, rows: trayRows(row, frame.files[row.id], frame.detail, open, h) };
    return last.rows;
  };
}

interface ProjectExpansionDeps {
  post: (message: AllProjectsToHost) => void;
  rowById: (id: string) => ProjectRow | undefined;
  select: (id: string) => void;
  detailOf: (id: string) => ProjectPaneContent | undefined;
  render: () => void;
}

export interface ProjectExpansion {
  frame(): ProjectTrayFrame;
  handlers: ProjectTrayHandlers & { onToggle: (id: string) => void };
  receive(message: Extract<HostToAllProjects, { type: "files" }>): void;
  /** Collapses the expanded project when it is no longer shown. */
  keepShown(shown: ReadonlySet<string>): void;
}

export function createProjectExpansion(deps: ProjectExpansionDeps): ProjectExpansion {
  let expanded: string | null = null;
  const files: Record<string, ProjectFiles> = {};
  const openFolders = new Set<string>();
  return {
    frame: () => ({ expanded, files: { ...files }, detail: expanded ? deps.detailOf(expanded) : undefined, openFolders }),
    handlers: {
      onToggle(id) {
        expanded = expanded === id ? null : id;
        if (expanded) { files[id] = { status: "loading" }; deps.post({ type: "files", id }); }
        deps.render();
      },
      onOpenFile(id, path) {
        deps.select(id);
        // Trashed projects only list their files; opening one would bring the project back into use.
        if (deps.rowById(id)?.place !== "trash") deps.post({ type: "openFile", id, path });
      },
      onToggleFolder(id, path) {
        const key = openFolderKey(id, path);
        if (!openFolders.delete(key)) openFolders.add(key);
        deps.select(id);
      },
      onOpenLog(id) {
        deps.post({ type: "openLog", id });
      },
      onAddFile(id) {
        void askInputBox({ title: "Add file", prompt: "File path in the project, e.g. sections/related.tex" }).then((path) => {
          if (path) deps.post({ type: "createFile", id, path });
        });
      },
    },
    receive(message) {
      files[message.id] = "error" in message ? { status: "failed", message: message.error } : { status: "ready", files: message.files };
      if (message.id === expanded) deps.render();
    },
    keepShown(shown) {
      if (expanded && !shown.has(expanded)) expanded = null;
    },
  };
}
