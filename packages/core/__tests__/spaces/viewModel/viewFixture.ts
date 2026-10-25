/** Builds Spaces, library entries and project infos for the view tests. */
import type { Space, SpaceDate, SpaceReadResult } from "../../../src/spaces/model/index";
import type { SpaceProjectEntry } from "../../../src/spaces/viewModel/index";
import type { PaperRecord } from "../../../src/model/index";

export const emptyInvalid = { folders: [], papers: [], projects: [], dates: [] };

export function space(over: Partial<Space> = {}): Space {
  return { id: "s", name: "Thesis", folders: [], papers: [], projects: [], dates: [], invalid: emptyInvalid, extra: {}, ...over };
}

export function date(id: string, over: Record<string, unknown> = {}): SpaceDate {
  return { id, kind: "deadline", title: `T-${id}`, date: "2026-11-01", extra: {}, ...over } as SpaceDate;
}

export function paperRef(id: string, over: Record<string, unknown> = {}) {
  return { id, focus: false, extra: {}, ...over };
}

export function folder(id: string, over: Record<string, unknown> = {}) {
  return { id, name: `F-${id}`, extra: {}, ...over };
}

export function library(...records: Array<Partial<PaperRecord> & { id: string }>): Map<string, { record: PaperRecord }> {
  return new Map(records.map((r) => [r.id, { record: { title: `Title ${r.id}`, path: r.id, citeKey: r.id, status: "unread", ...r } as PaperRecord }]));
}

export function ready(s: Space): SpaceReadResult<string> {
  return { state: "ready", path: `/spaces/${s.id}/space.json`, space: s, warnings: [] };
}

export function project(projectId: string, over: Partial<SpaceProjectEntry> = {}): SpaceProjectEntry {
  return { projectId, title: `Project ${projectId}`, available: true, ...over };
}
