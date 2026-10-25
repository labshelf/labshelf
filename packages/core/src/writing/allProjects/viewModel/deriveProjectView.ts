// Turns the project rows into the groups the All projects page shows for one view state.
import type { ProjectPlace, ProjectRow } from "../projectRow.js";
import type { ProjectSortField, ProjectViewState } from "./projectViewState.js";

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
