// Maps a writing project entry to the row the sidebar Projects section shows, with its mark, count and tooltip.
import type { ProjectEntry, ReadingList } from "@labshelf/core";
import type { SidebarProjectItem } from "../../ui/library/index.js";

export type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;
export type BrokenEntry = Extract<ProjectEntry, { kind: "broken" }>;
export interface Counted { open: number; stale: number }
export interface LastBuild { ok: boolean; at: Date }

const GROUPS: Record<ProjectEntry["location"], string> = { library: "In library", external: "External folders" };

type Mark = { tone: SidebarProjectItem["mark"]["tone"]; label: string };

function markOf(counted: Counted | undefined, build: LastBuild | undefined): Mark {
  if (!counted) { return { tone: "accent", label: "Counting…" }; }
  if (build && !build.ok) { return { tone: "err", label: "Last build failed" }; }
  return counted.open > 0 ? { tone: "warn", label: `${counted.open} open` } : { tone: "ok", label: "Nothing open" };
}

const pad = (value: number): string => String(value).padStart(2, "0");

function engineOf(entry: ReadyEntry): string {
  if (entry.settings.format === "typst") { return "typst"; }
  return entry.settings.engine ?? "compiler not chosen";
}

/** One line per fact worth a glance; the reading and stale-figure lines appear only when they have something to say. */
export function detailLines(entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, reading: ReadingList): string[] {
  const lines = [`${entry.main ?? "no main file"} · ${engineOf(entry)}`];
  if (build) { lines.push(`Last build ${build.ok ? "succeeded" : "failed"} ${pad(build.at.getHours())}:${pad(build.at.getMinutes())}`); }
  const inLibrary = reading.entries.filter((candidate) => candidate.paper);
  if (inLibrary.length > 0) {
    lines.push(`Reading ${inLibrary.filter((candidate) => candidate.paper?.status === "done").length} of ${inLibrary.length}`);
  }
  if (counted && counted.stale > 0) { lines.push(`${counted.stale} stale figures`); }
  return lines;
}

export function readyProjectItem(
  entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, reading: ReadingList,
): SidebarProjectItem {
  const { tone, label } = markOf(counted, build);
  const external = entry.location === "external";
  const tooltip = [entry.settings.id, label, ...detailLines(entry, counted, build, reading), ...(external ? [entry.folder] : [])];
  return {
    id: entry.folder,
    name: entry.settings.id,
    group: GROUPS[entry.location],
    mark: { tone, progress: counted ? "full" : "none" },
    ...(counted && counted.open > 0 ? { count: String(counted.open) } : {}),
    tooltip: tooltip.join("\n"),
    kind: "ready",
    external,
  };
}

export function brokenProjectItem(entry: BrokenEntry): SidebarProjectItem {
  return {
    id: entry.folder,
    name: entry.folder.split(/[\\/]/).pop() ?? entry.folder,
    group: GROUPS[entry.location],
    mark: { tone: "err", progress: "full" },
    count: "missing",
    tooltip: `${entry.folder}\n${entry.reason}`,
    kind: "broken",
    external: entry.location === "external",
  };
}
