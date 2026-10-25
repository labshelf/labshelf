// Builds the tray entries of a writing project: each file's role and fact, the build log row and the Add file row.
import { formatCompactTime } from "../../../../library/index.js";
import type { TrayEntry } from "../../../../libraryUi/dom/index.js";
import type { ProjectPaneContent } from "../../projectDetailPane.js";
import type { ProjectRow } from "../../projectRow.js";
import type { FileTreeEntry } from "./deriveProjectFileTree.js";
import { formatCount } from "../../../../ui/index.js";

const MAX_CONTENTS = 4;

const toneOf = (ext: string): TrayEntry["tone"] => ext === "pdf" ? "pdf" : ext === "md" ? "md" : "other";
const baseName = (path: string): string => /([^/]*?)(\.[^./]*)?$/.exec(path)?.[1] ?? path;

// The build outcome only counts problems when a build ran in this session.
const hasOutcome = (d: ProjectPaneContent): boolean => d.build.state === "ok" || d.build.state === "warnings" || d.build.state === "failed";

function outcome(d: ProjectPaneContent): string[] {
  return hasOutcome(d) ? [formatCount(d.build.warnings, "warning"), formatCount(d.build.errors, "error")] : [];
}

function mainFact(d: ProjectPaneContent): string {
  const first = d.build.first;
  const where = first?.file ? ` in ${first.file}${first.line !== undefined ? `:${first.line}` : ""}` : "";
  const problems = hasOutcome(d) ? [d.build.warnings > 0 && formatCount(d.build.warnings, "warning"), d.build.errors > 0 && formatCount(d.build.errors, "error")] : [];
  return [d.pages !== undefined && formatCount(d.pages, "page"), ...problems, first && first.message + where].filter(Boolean).join(" · ");
}

/** The bibliography sentence the tray and the Overview tab share. */
export function deriveBibliographyFact(bib: NonNullable<ProjectPaneContent["bibliography"]>, now = Date.now()): string {
  const entries = `${bib.entries} ${bib.entries === 1 ? "entry" : "entries"}`;
  if (!bib.generated) return entries;
  return `${entries} written from the library${bib.written !== undefined ? ` · synced ${formatCompactTime(bib.written, now)} ago` : ""}`;
}

function contentsFact(folder: string, sources: readonly string[]): string | null {
  const inside = sources.filter((s) => s.startsWith(`${folder}/`)).map(baseName);
  if (inside.length === 0) return null;
  const names = [...new Set(inside)];
  return names.slice(0, MAX_CONTENTS).join(", ") + (names.length > MAX_CONTENTS ? ", …" : "");
}

function factOf(f: FileTreeEntry, row: ProjectRow, detail: ProjectPaneContent | undefined): TrayEntry["fact"] {
  if (f.path === row.main) return { label: "Main", text: detail ? mainFact(detail) : "" };
  if (!detail) return null;
  if (f.folder) {
    const text = contentsFact(f.path, detail.sources);
    return text ? { label: "Contents", text } : null;
  }
  return detail.bibliography?.file === f.path ? { label: "Bibliography", text: deriveBibliographyFact(detail.bibliography) } : null;
}

/** The row for one file or folder of the tree; the fact fills in once the detail arrives. */
export function createProjectFileEntry(f: FileTreeEntry, row: ProjectRow, detail: ProjectPaneContent | undefined): TrayEntry {
  if (f.folder) return { kind: "folder", name: f.name, type: "", tone: "dir", fact: factOf(f, row, detail), title: f.path };
  const ext = /\.([^.]+)$/.exec(f.name)?.[1]?.toLowerCase() ?? "";
  return { kind: "file", name: f.name, type: ext.slice(0, 4).toUpperCase(), tone: toneOf(ext), fact: factOf(f, row, detail), title: f.path };
}

/** The last build's log; absent until the detail says one exists. */
export function createProjectLogEntry(detail: ProjectPaneContent | undefined): TrayEntry | null {
  if (!detail?.log) return null;
  const text = [...outcome(detail), detail.pages !== undefined && formatCount(detail.pages, "page")].filter(Boolean).join(", ");
  return { kind: "file", name: detail.log, type: "LOG", tone: "other", fact: { label: "Last build", text }, title: detail.log };
}

/** Its type cell holds an add icon instead of a type label. */
export const ADD_FILE_ENTRY: TrayEntry = { kind: "file", name: "+ Add file", type: "", tone: "other", fact: null, title: "Add file" };
