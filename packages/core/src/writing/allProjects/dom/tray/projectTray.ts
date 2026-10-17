// Fills the expanded project's tray with its file tree, log and Add file rows and empties every other tray, rebuilding a tray only when its inputs change.
import { buildFailedRow, buildLoadingRow, buildTrayRow, replaceTrayRows } from "../../../../library-ui/dom/index.js";
import { icon } from "../../../../ui/index.js";
import type { ProjectDetail } from "../../projectDetail.js";
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

// What each tray was last built from, so a selection change keeps its rows and focus.
const built = new WeakMap<HTMLElement, unknown[]>();

function fileRows(row: ProjectRow, files: string[], detail: ProjectDetail | undefined, open: ReadonlySet<string>, h: ProjectTrayHandlers): HTMLElement[] {
  return projectFileTree(files, open).map((f) => {
    const r = buildTrayRow(projectFileEntry(f, row, detail), () => (f.folder ? h.onToggleFolder : h.onOpenFile)(row.id, f.path));
    // Focus keeping matches rows by kind and name, and names repeat across folders.
    r.dataset["name"] = f.path;
    r.setAttribute("aria-level", String(2 + f.depth));
    r.style.setProperty("--depth", String(f.depth));
    if (f.folder) { r.setAttribute("aria-expanded", String(f.open)); r.classList.toggle("open", f.open); }
    return r;
  });
}

// A trashed project only lists its files, so it offers neither the log nor a new file.
function actionRows(row: ProjectRow, detail: ProjectDetail | undefined, h: ProjectTrayHandlers): HTMLElement[] {
  if (row.place === "trash") return [];
  const out: HTMLElement[] = [];
  const log = projectLogEntry(detail);
  if (log) {
    const r = buildTrayRow(log, () => h.onOpenLog(row.id));
    r.dataset["name"] = ":log";
    out.push(r);
  }
  const add = buildTrayRow(ADD_FILE_ENTRY, () => h.onAddFile(row.id));
  add.dataset["name"] = ":add";
  add.querySelector(".file-type")!.innerHTML = icon("plus");
  return [...out, add];
}

function trayRows(row: ProjectRow, state: ProjectFiles | undefined, detail: ProjectDetail | undefined, open: ReadonlySet<string>, h: ProjectTrayHandlers): HTMLElement[] {
  if (!state || state.status === "loading") return [buildLoadingRow()];
  if (state.status === "failed") return [buildFailedRow(state.message)];
  // The log has its own row, so the tree leaves it out.
  const files = row.place === "trash" || !detail?.log ? state.files : state.files.filter((p) => p !== detail.log);
  return [...fileRows(row, files, detail, open, h), ...actionRows(row, detail, h)];
}

function openFoldersOf(id: string, frame: ProjectTrayFrame): Set<string> {
  const prefix = openFolderKey(id, "");
  return new Set([...frame.openFolders].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}

/** Call after the rows are rendered; `rows` maps the shown rows by id. */
export function paintProjectTray(root: HTMLElement, rows: ReadonlyMap<string, ProjectRow>, frame: ProjectTrayFrame, h: ProjectTrayHandlers): void {
  root.querySelectorAll<HTMLElement>(".paper-row").forEach((unit) => {
    const tray = unit.querySelector<HTMLElement>(".paper-children");
    const row = rows.get(unit.dataset["id"] ?? "");
    if (!tray) return;
    if (!row || row.id !== frame.expanded) {
      if (built.delete(tray)) tray.replaceChildren();
      return;
    }
    const open = openFoldersOf(row.id, frame);
    const inputs = [row, frame.files[row.id], frame.detail, [...open].sort().join("\n")];
    const last = built.get(tray);
    if (last && inputs.every((v, i) => v === last[i])) return;
    built.set(tray, inputs);
    replaceTrayRows(tray, trayRows(row, frame.files[row.id], frame.detail, open, h));
  });
}
