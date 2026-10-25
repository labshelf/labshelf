// Builds the catalog rows of all Spaces and filters them by text and scope.
import type { Space, SpaceReadResult } from "../model/index.js";
import { resolvePaper, type LibraryPapers } from "./resolvePaper.js";
import type { CatalogRow } from "./spaceViewModel.js";

export interface CatalogFilter {
  readonly text: string;
  readonly scope: "all" | "personal" | "shared";
}

/** The earliest date on or after today that is not a finished task. */
function nextOpenDate(space: Space, today: string): CatalogRow["next"] {
  const open = space.dates
    .filter((d) => d.date >= today && !(d.kind === "task" && d.done))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return open ? { date: open.date, title: open.title } : null;
}

function readyRow(space: Space, library: LibraryPapers, today: string): CatalogRow {
  const done = space.papers.filter((p) => {
    const paper = resolvePaper(p.id, library);
    return !paper.missing && paper.status === "done";
  }).length;
  return {
    id: space.id,
    name: space.name,
    ...(space.purpose === undefined ? {} : { purpose: space.purpose }),
    reading: { done, total: space.papers.length },
    next: nextOpenDate(space, today),
    counts: { papers: space.papers.length, projects: space.projects.length },
    shared: false,
  };
}

export function catalogRows(results: readonly SpaceReadResult<unknown>[], library: LibraryPapers, today: string): CatalogRow[] {
  return results.map((r) =>
    r.state === "ready"
      ? readyRow(r.space, library, today)
      : { id: r.id, name: r.id, reading: { done: 0, total: 0 }, next: null, counts: { papers: 0, projects: 0 }, shared: false, unreadable: r.reason });
}

/** Shared Spaces do not exist yet, so the Shared scope is empty. */
export function filterCatalog(rows: readonly CatalogRow[], filter: CatalogFilter): CatalogRow[] {
  if (filter.scope === "shared") return [];
  const needle = filter.text.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => `${r.name}\n${r.purpose ?? ""}`.toLowerCase().includes(needle));
}
