// Builds the expanded project's tray rows (file tree, log and Add file), reusing the last rows while their inputs stay the same.
import { buildFailedRow, buildLoadingRow, buildTrayRow } from "../../../../libraryUi/dom/index.js";
import { renderIcon } from "../../../../ui/index.js";
import type { ProjectDetail } from "../../projectDetailPane.js";
import type { ProjectRow } from "../../projectRow.js";
import { projectFileTree } from "./projectFileTree.js";
import { ADD_FILE_ENTRY, projectFileEntry, projectLogEntry } from "./projectTrayFacts.js";

export type ProjectFiles = { status: "loading" } | { status: "ready"; files: string[] } | { status: "failed"; message: string };

export interface ProjectTrayFrame {
  expanded: string | null;
  files: Readonly<Record<string, ProjectFiles>>;
  /** The expanded project's last detail; the tray shows names and the Main role without it. */
  detail: ProjectDetail | undefined;
  /** Keys come from `openFolderKey`. */
  openFolders: ReadonlySet<string>;
}

export interface ProjectTrayHandlers {
  onOpenFile: (id: string, path: string) => void;
  onToggleFolder: (id: string, path: string) => void;
  onOpenLog: (id: string) => void;
  onAddFile: (id: string) => void;
}

export const openFolderKey = (id: string, path: string): string => `${id}\n${path}`;

/** One tray row; `name` is unique within the tray and `depth` counts folders below the project. */
export interface ProjectTrayRow {
  name: string;
  depth: number;
  node: HTMLElement;
}

const trayRow = (node: HTMLElement, depth = 0): ProjectTrayRow => ({ name: node.dataset["name"]!, depth, node });

function fileRows(row: ProjectRow, files: string[], detail: ProjectDetail | undefined, open: ReadonlySet<string>, h: ProjectTrayHandlers): ProjectTrayRow[] {
  return projectFileTree(files, open).map((f) => {
    const r = buildTrayRow(projectFileEntry(f, row, detail), () => (f.folder ? h.onToggleFolder : h.onOpenFile)(row.id, f.path));
    // Rows are keyed by name, and names repeat across folders.
    r.dataset["name"] = f.path;
    r.style.setProperty("--depth", String(f.depth));
    if (f.folder) { r.setAttribute("aria-expanded", String(f.open)); r.classList.toggle("open", f.open); }
    return trayRow(r, f.depth);
  });
}

// A trashed project only lists its files, so it offers neither the log nor a new file.
function actionRows(row: ProjectRow, detail: ProjectDetail | undefined, h: ProjectTrayHandlers): ProjectTrayRow[] {
  if (row.place === "trash") return [];
  const out: ProjectTrayRow[] = [];
  const log = projectLogEntry(detail);
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

function trayRows(row: ProjectRow, state: ProjectFiles | undefined, detail: ProjectDetail | undefined, open: ReadonlySet<string>, h: ProjectTrayHandlers): ProjectTrayRow[] {
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
