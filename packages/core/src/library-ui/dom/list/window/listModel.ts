// Flattens paper groups into fixed-height rows (a label row per labelled group, then its papers) and cuts windowed groups.
import type { PaperGroup } from "../groups/index.js";

/** Where one paper sits in the flat rows, and whether a sticky group label covers the top of the viewport above it. */
export interface PaperPlace {
  row: number;
  labelled: boolean;
}

export interface ListModel {
  groups: readonly PaperGroup[];
  /** Flat row count, labels included. */
  rows: number;
  /** The flat row of each group's first row (its label, or its first paper when unlabelled). */
  starts: number[];
  /** One entry per paper, in list order. */
  papers: PaperPlace[];
  /** The list index of each paper id. */
  indexOf: Map<string, number>;
}

/** The groups that the flat rows `start` to `end` show; `stickyLabel` is set when the first group's label sits above `start`. */
export interface GroupWindow {
  groups: PaperGroup[];
  stickyLabel: boolean;
}

const labelRows = (g: PaperGroup): number => (g.segments.length > 0 ? 1 : 0);

export function buildListModel(groups: readonly PaperGroup[]): ListModel {
  const starts: number[] = [];
  const papers: PaperPlace[] = [];
  const indexOf = new Map<string, number>();
  let row = 0;
  for (const g of groups) {
    starts.push(row);
    row += labelRows(g);
    for (const p of g.papers) {
      indexOf.set(p.id, papers.length);
      papers.push({ row: row++, labelled: labelRows(g) > 0 });
    }
  }
  return { groups, rows: row, starts, papers, indexOf };
}

/** Copies of the groups cut to the flat rows `start` (inclusive) to `end` (exclusive); each keeps its full `total`. */
export function windowGroups(model: ListModel, start: number, end: number): GroupWindow {
  const out: PaperGroup[] = [];
  let stickyLabel = false;
  model.groups.forEach((g, i) => {
    const first = model.starts[i]! + labelRows(g);
    const last = first + g.papers.length;
    if (last <= start || model.starts[i]! >= end) return;
    // A slice that starts inside a labelled group still renders the label, so the sticky label stays over its papers.
    if (out.length === 0 && labelRows(g) > 0 && start > model.starts[i]!) stickyLabel = true;
    out.push({ ...g, papers: g.papers.slice(Math.max(0, start - first), Math.max(0, end - first)) });
  });
  return { groups: out, stickyLabel };
}
