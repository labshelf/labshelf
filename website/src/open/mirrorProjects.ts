// Groups the Mirror's project rows into projects: settings from labshelf.yaml, source files, decks and compiled PDFs (output rows in parts).
import { parseProjectFile } from "@labshelf/core";

import { isSafeSegment } from "../share/shareLibrary.js";

export interface MirrorRow { path: string; kind: string; size?: number; updated?: number }

export interface MirrorProject {
  /** The folder name under projects/, the sidebar's key. */
  folder: string;
  /** labshelf.yaml's id, or the folder name without one. */
  id: string;
  name: string;
  format?: "latex" | "typst";
  main?: string;
  /** Archived or trashed. */
  hidden: boolean;
  /** Source paths relative to the project folder. */
  files: string[];
  /** Full row paths of deck.html files. */
  decks: string[];
  /** Full library paths of compiled PDFs, each with the row paths of its parts. */
  outputs: { path: string; parts: string[] }[];
}

const SETTINGS_FILE = "labshelf.yaml";

function projectOf(map: Map<string, MirrorProject>, folder: string): MirrorProject {
  let project = map.get(folder);
  if (!project) { project = { folder, id: folder, name: folder, hidden: false, files: [], decks: [], outputs: [] }; map.set(folder, project); }
  return project;
}

/** Reads the projects the rows list; a labshelf.yaml that cannot be read or parsed leaves the folder's defaults. Old Mirrors give fewer rows, never an error. */
export async function readMirrorProjects(rows: readonly MirrorRow[], read: (path: string) => Promise<string>): Promise<MirrorProject[]> {
  const map = new Map<string, MirrorProject>();
  const outputs = new Map<string, string[]>();
  const settings: [MirrorProject, string][] = [];
  for (const row of rows) {
    const segments = row.path.split("/");
    if (segments[0] !== "projects" || segments.length < 3 || !segments.every(isSafeSegment)) { continue; }
    const project = projectOf(map, segments[1]!);
    const rest = segments.slice(2).join("/");
    if (row.kind === "source" && rest === SETTINGS_FILE) { settings.push([project, row.path]); }
    if (row.kind === "source") { project.files.push(rest); }
    else if (row.kind === "deck") { project.decks.push(row.path); }
    else if (row.kind === "output" && segments.length >= 4 && /\.pdf$/i.test(segments[segments.length - 2]!)) {
      const pdf = segments.slice(0, -1).join("/");
      outputs.set(pdf, [...(outputs.get(pdf) ?? []), row.path]);
    }
  }
  for (const [pdf, parts] of outputs) { projectOf(map, pdf.split("/")[1]!).outputs.push({ path: pdf, parts }); }
  await Promise.all(settings.map(async ([project, path]) => {
    try {
      const parsed = parseProjectFile(await read(path));
      if (!parsed.ok) { return; }
      const s = parsed.settings;
      project.id = s.id;
      project.name = s.title ?? project.folder;
      project.format = s.format;
      if (s.main !== undefined) { project.main = s.main; }
      project.hidden = s.archived === true || s.trashed !== undefined;
    } catch {
      // The folder keeps its defaults.
    }
  }));
  for (const project of map.values()) {
    project.files.sort();
    project.decks.sort();
    project.outputs.sort((a, b) => a.path.localeCompare(b.path));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
