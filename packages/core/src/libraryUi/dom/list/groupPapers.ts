// Splits the sorted papers of a folder scope into the group of papers directly in it and one group per subfolder.
import type { ListPaper } from "../../viewModel/index.js";

const SEP = "/";
const LABEL_SEP = " › ";
const MAX_SEGMENTS = 3;

/** Papers that share one holder folder. */
export interface PaperGroup {
  /** The holder folder's path; distinct per group. */
  key: string;
  /** Holder folder path below the scope; empty for the papers directly in the scope. */
  segments: string[];
  papers: ListPaper[];
  /** The group's paper count, also when `papers` is cut to the rendered window. */
  total: number;
}

function segmentsBelow(scope: string, folderPath: string): string[] {
  return folderPath === scope ? [] : folderPath.slice(scope.length + 1).split(SEP);
}

/** The own group first (when it has papers), then the subfolder groups by path; `papers` keep their order inside each. */
export function groupPapers(papers: readonly ListPaper[], scope: string): PaperGroup[] {
  const byFolder = new Map<string, PaperGroup>();
  for (const p of papers) {
    const group = byFolder.get(p.folderPath) ?? { key: p.folderPath, segments: segmentsBelow(scope, p.folderPath), papers: [], total: 0 };
    group.papers.push(p);
    group.total++;
    byFolder.set(p.folderPath, group);
  }
  const path = (g: PaperGroup): string => g.segments.join(SEP);
  return [...byFolder.values()].sort((a, b) => path(a).localeCompare(path(b)));
}

/** The indices of the segments the label shows (first, second-last and last past three) and the full path for its tooltip. */
export function groupLabel(segments: readonly string[]): { shown: number[]; title: string } {
  const n = segments.length;
  return { shown: n <= MAX_SEGMENTS ? segments.map((_, i) => i) : [0, n - 2, n - 1], title: segments.join(LABEL_SEP) };
}

/** The accessible name of a group: its full path and paper count. */
export function groupAriaLabel(segments: readonly string[], count: number): string {
  return `${segments.join(LABEL_SEP)}, ${count} ${count === 1 ? "paper" : "papers"}`;
}
