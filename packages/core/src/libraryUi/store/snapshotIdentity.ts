/**
 * Merges a host snapshot into the state so that every record, reading stat, folder tree and PDF set equal to what the
 * state holds keeps its object identity. Views compare by reference, so an unchanged library never re-renders a row.
 */
import type { LibraryUiSnapshot } from "../protocol/index.js";
import type { LibraryViewState } from "./viewState.js";

type SnapshotSlices = Pick<LibraryViewState, "folders" | "papers" | "pdfDirs" | "stats">;

/** Structural equality for JSON values. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const bk = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function samePapers(prev: LibraryViewState["papers"], next: LibraryViewState["papers"]): LibraryViewState["papers"] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  const merged = next.map((p) => {
    const old = byId.get(p.id);
    return old && sameJson(old, p) ? old : p;
  });
  return merged.length === prev.length && merged.every((p, i) => p === prev[i]) ? prev : merged;
}

function samePdfDirs(prev: ReadonlySet<string>, next: string[]): ReadonlySet<string> {
  const set = new Set(next);
  return set.size === prev.size && [...set].every((d) => prev.has(d)) ? prev : set;
}

function sameStats(prev: LibraryViewState["stats"], next: LibraryUiSnapshot["stats"]): LibraryViewState["stats"] {
  const merged: Record<string, LibraryUiSnapshot["stats"][string]> = {};
  let changed = Object.keys(prev).length !== Object.keys(next).length;
  for (const [id, stat] of Object.entries(next)) {
    const old = prev[id];
    merged[id] = old && sameJson(old, stat) ? old : stat;
    if (merged[id] !== old) changed = true;
  }
  return changed ? merged : prev;
}

/** The snapshot's slices, reusing the state's objects wherever the content is equal. */
export function mergeSnapshot(state: LibraryViewState, snapshot: LibraryUiSnapshot): SnapshotSlices {
  return {
    folders: sameJson(state.folders, snapshot.folders) ? state.folders : snapshot.folders,
    papers: samePapers(state.papers, snapshot.papers),
    pdfDirs: samePdfDirs(state.pdfDirs, snapshot.pdfDirs),
    stats: sameStats(state.stats, snapshot.stats),
  };
}
