// Fills the expanded project's tray with its file tree and empties every other tray, rebuilding a tray only when its inputs change.
import { buildFailedRow, buildLoadingRow, buildTrayRow, replaceTrayRows, type TrayEntry } from "../../../../library-ui/dom/index.js";
import type { ProjectRow } from "../../projectRow.js";
import { projectFileTree, type FileTreeEntry } from "./projectFileTree.js";

export type ProjectFiles = { status: "loading" } | { status: "ready"; files: string[] } | { status: "failed"; message: string };

export interface ProjectTrayFrame {
  expanded: string | null;
  files: Readonly<Record<string, ProjectFiles>>;
  /** Keys come from `openFolderKey`. */
  openFolders: ReadonlySet<string>;
}

export interface ProjectTrayHandlers {
  onOpenFile: (id: string, path: string) => void;
  onToggleFolder: (id: string, path: string) => void;
}

export const openFolderKey = (id: string, path: string): string => `${id}\n${path}`;

// What each tray was last built from, so a selection change keeps its rows and focus.
const built = new WeakMap<HTMLElement, unknown[]>();

const toneOf = (ext: string): TrayEntry["tone"] => ext === "pdf" ? "pdf" : ext === "md" ? "md" : "other";

function trayEntry(f: FileTreeEntry, main: string | undefined): TrayEntry {
  if (f.folder) return { kind: "folder", name: f.name, type: "", tone: "dir", fact: null, title: f.path };
  const ext = /\.([^.]+)$/.exec(f.name)?.[1]?.toLowerCase() ?? "";
  const fact = f.path === main ? { label: "", text: "main document" } : null;
  return { kind: "file", name: f.name, type: ext.slice(0, 4).toUpperCase(), tone: toneOf(ext), fact, title: f.path };
}

function fileRows(row: ProjectRow, files: string[], open: ReadonlySet<string>, h: ProjectTrayHandlers): HTMLElement[] {
  return projectFileTree(files, open).map((f) => {
    const r = buildTrayRow(trayEntry(f, row.main), () => (f.folder ? h.onToggleFolder : h.onOpenFile)(row.id, f.path));
    // Focus keeping matches rows by kind and name, and names repeat across folders.
    r.dataset["name"] = f.path;
    r.setAttribute("aria-level", String(2 + f.depth));
    r.style.setProperty("--depth", String(f.depth));
    if (f.folder) { r.setAttribute("aria-expanded", String(f.open)); r.classList.toggle("open", f.open); }
    return r;
  });
}

function trayRows(row: ProjectRow, state: ProjectFiles | undefined, open: ReadonlySet<string>, h: ProjectTrayHandlers): HTMLElement[] {
  if (!state || state.status === "loading") return [buildLoadingRow()];
  if (state.status === "failed") return [buildFailedRow(state.message)];
  return fileRows(row, state.files, open, h);
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
    const inputs = [row, frame.files[row.id], [...open].sort().join("\n")];
    const last = built.get(tray);
    if (last && inputs.every((v, i) => v === last[i])) return;
    built.set(tray, inputs);
    replaceTrayRows(tray, trayRows(row, frame.files[row.id], open, h));
  });
}
