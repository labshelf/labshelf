// Maps a writing project entry to the row the sidebar Projects section shows, with its count and tooltip.
import type { ProjectEntry } from "../../writing/project/index.js";
import type { ReadingList } from "../../writing/readingList/index.js";

/** A writing project as the sidebar lists it; `id` is the host's opaque key (a folder path). */
export interface SidebarProject {
  id: string;
  name: string;
  /** Absent when the project's settings cannot be read. */
  format?: "latex" | "typst";
  /** Folder path inside My projects, segments joined by "/"; absent at the top level. */
  folder?: string;
  /** Archived or trashed: left out of the tree, listed only in the All projects tab. */
  hidden?: true;
  /** The project carries a share id, so this device joined or shared it. */
  shared?: true;
  /** Right-aligned text, like a folder's count. */
  count?: string;
  /** Multi-line `title` attribute. */
  tooltip: string;
}

/** A sidebar project plus what a host needs to offer the right menu. */
export interface SidebarProjectItem extends SidebarProject {
  kind: "ready" | "broken";
  external: boolean;
}

export type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;
export type BrokenEntry = Extract<ProjectEntry, { kind: "broken" }>;
export interface Counted { open: number; stale: number }
export interface LastBuild { ok: boolean; at: Date }

const pad = (value: number): string => String(value).padStart(2, "0");

function engineOf(entry: ReadyEntry): string {
  if (entry.settings.format === "typst") return "typst";
  return entry.settings.engine ?? "compiler not chosen";
}

/** One line per fact worth a glance; the reading and stale-figure lines appear only when they have something to say. */
export function detailLines(entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, reading: ReadingList): string[] {
  const lines = [`${entry.main ?? "no main file"} · ${engineOf(entry)}`];
  if (build) lines.push(`Last build ${build.ok ? "succeeded" : "failed"} ${pad(build.at.getHours())}:${pad(build.at.getMinutes())}`);
  const inLibrary = reading.entries.filter((candidate) => candidate.paper);
  if (inLibrary.length > 0) {
    lines.push(`Reading ${inLibrary.filter((candidate) => candidate.paper?.status === "done").length} of ${inLibrary.length}`);
  }
  if (counted && counted.stale > 0) lines.push(`${counted.stale} stale figures`);
  return lines;
}

/** `counted` and `build` are undefined when the host does not know them yet or cannot know them. */
export function readyProjectItem(
  entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, reading: ReadingList,
): SidebarProjectItem {
  const external = entry.location === "external";
  const tooltip = [entry.settings.id, ...detailLines(entry, counted, build, reading), ...(external ? [entry.folder] : [])];
  return {
    id: entry.folder,
    name: entry.settings.title ?? entry.settings.id,
    format: entry.settings.format,
    ...(entry.settings.folder ? { folder: entry.settings.folder } : {}),
    ...(entry.settings.archived || entry.settings.trashed ? { hidden: true as const } : {}),
    ...(entry.settings.shared ? { shared: true as const } : {}),
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
    count: "missing",
    tooltip: `${entry.folder}\n${entry.reason}`,
    kind: "broken",
    external: entry.location === "external",
  };
}
