// Maps a writing project entry to the row the All projects page lists.
import type { PathOps } from "../../../library/mutations/index.js";
import type { ProjectEntry } from "../../project/index.js";
import type { BuildMark, ProjectPlace, ProjectRow } from "../projectRow.js";

const placeOf = (entry: Extract<ProjectEntry, { kind: "ready" }>): ProjectPlace =>
  entry.settings.trashed ? "trash" : entry.settings.archived ? "archived" : "projects";

export interface ProjectRowExtras {
  cites?: { cites: number; unresolved: number } | undefined;
  build?: BuildMark;
}

export function toProjectRow(paths: PathOps, entry: ProjectEntry, modified: number | undefined, extras: ProjectRowExtras = {}): ProjectRow {
  const external = entry.location === "external";
  if (entry.kind === "broken") {
    return { id: entry.folder, title: paths.basename(entry.folder), place: "projects", external, broken: entry.reason };
  }
  const { settings } = entry;
  const { cites, build } = extras;
  return {
    id: entry.folder,
    title: settings.title ?? settings.id,
    format: settings.format,
    ...(entry.main ? { main: paths.relative(entry.folder, paths.resolve(entry.folder, entry.main)).split(paths.sep).join("/") } : {}),
    ...(settings.folder ? { folder: settings.folder } : {}),
    place: placeOf(entry),
    ...(modified !== undefined ? { modified } : {}),
    ...(settings.trashed ? { trashedAt: settings.trashed } : {}),
    ...(cites ? { cites: cites.cites, unresolvedCites: cites.unresolved } : {}),
    ...(build ? { build } : {}),
    ...(settings.target ? { target: settings.target } : {}),
    ...(settings.shared ? { shared: true } : {}),
    external,
  };
}
