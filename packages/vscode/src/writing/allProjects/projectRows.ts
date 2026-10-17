// Maps a writing project entry to the row the All projects page lists.
import * as path from "node:path";
import type { BuildMark, ProjectEntry, ProjectPlace, ProjectRow } from "@labshelf/core";

const placeOf = (entry: Extract<ProjectEntry, { kind: "ready" }>): ProjectPlace =>
  entry.settings.trashed ? "trash" : entry.settings.archived ? "archived" : "projects";

export interface ProjectRowExtras {
  cites?: { cites: number; unresolved: number } | undefined;
  build?: BuildMark;
}

export function toProjectRow(entry: ProjectEntry, modified: number | undefined, extras: ProjectRowExtras = {}): ProjectRow {
  const external = entry.location === "external";
  if (entry.kind === "broken") {
    return { id: entry.folder, title: path.basename(entry.folder), place: "projects", external, broken: entry.reason };
  }
  const { settings } = entry;
  const { cites, build } = extras;
  return {
    id: entry.folder,
    title: settings.title ?? settings.id,
    format: settings.format,
    ...(entry.main ? { main: path.relative(entry.folder, path.resolve(entry.folder, entry.main)).split(path.sep).join("/") } : {}),
    ...(settings.folder ? { folder: settings.folder } : {}),
    place: placeOf(entry),
    ...(modified !== undefined ? { modified } : {}),
    ...(settings.trashed ? { trashedAt: settings.trashed } : {}),
    ...(cites ? { cites: cites.cites, unresolvedCites: cites.unresolved } : {}),
    ...(build ? { build } : {}),
    ...(settings.target ? { target: settings.target } : {}),
    external,
  };
}
