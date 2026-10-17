// Maps a writing project entry to the row the All projects page lists.
import * as path from "node:path";
import type { ProjectEntry, ProjectPlace, ProjectRow } from "@labshelf/core";

const placeOf = (entry: Extract<ProjectEntry, { kind: "ready" }>): ProjectPlace =>
  entry.settings.trashed ? "trash" : entry.settings.archived ? "archived" : "projects";

/** @param count The sidebar's open-items text: a number, or "counting" and "missing" while it is not known. */
export function toProjectRow(entry: ProjectEntry, count: string | undefined, modified: number | undefined): ProjectRow {
  const external = entry.location === "external";
  if (entry.kind === "broken") {
    return { id: entry.folder, title: path.basename(entry.folder), place: "projects", external, broken: entry.reason };
  }
  const { settings } = entry;
  const openItems = count !== undefined && /^\d+$/.test(count) ? Number(count) : undefined;
  return {
    id: entry.folder,
    title: settings.title ?? settings.id,
    format: settings.format,
    ...(entry.main ? { main: path.relative(entry.folder, path.resolve(entry.folder, entry.main)).split(path.sep).join("/") } : {}),
    ...(settings.folder ? { folder: settings.folder } : {}),
    place: placeOf(entry),
    ...(modified !== undefined ? { modified } : {}),
    ...(settings.trashed ? { trashedAt: settings.trashed } : {}),
    ...(openItems !== undefined ? { openItems } : {}),
    external,
  };
}
