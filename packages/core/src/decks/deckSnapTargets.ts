// Extra snap targets of a deck block (D3, A8): the lines of the layout grid and the positions that make gaps between blocks equal.
import { deckGridLines, type DeckGrid } from "./deckGrid.js";
import type { DeckRect } from "./deckParse.js";
import type { SnapGuide } from "./deckSnap.js";

/** Start and end of a rect on one axis. */
interface Span { start: number; end: number }

const round2 = (value: number): number => Math.round(value * 100) / 100;

const along = (rect: DeckRect, axis: "x" | "y"): Span =>
  axis === "x" ? { start: rect.left, end: rect.left + rect.width } : { start: rect.top, end: rect.top + rect.height };

const across = (rect: DeckRect, axis: "x" | "y"): Span => along(rect, axis === "x" ? "y" : "x");

/** The overlap of two spans, or null when it is not positive. */
function overlap(a: Span, b: Span): Span | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/** The column starts and ends (x) or row starts and ends (y) of the grid. */
export function gridTargets(grid: DeckGrid, canvas: { width: number; height: number }, axis: "x" | "y"): number[] {
  return deckGridLines(grid, canvas)[axis];
}

/** The nearest other entirely before (side -1) or after (side 1) the rect on the axis that overlaps it on the other axis. */
function neighbour(rect: DeckRect, axis: "x" | "y", others: readonly DeckRect[], side: -1 | 1): DeckRect | null {
  const own = along(rect, axis);
  const band = across(rect, axis);
  let best: DeckRect | null = null;
  let bestGap = Infinity;
  for (const other of others) {
    if (other === rect || !overlap(band, across(other, axis))) continue;
    const span = along(other, axis);
    const gap = side < 0 ? own.start - span.end : span.start - own.end;
    if (gap >= 0 && gap < bestGap) {
      best = other;
      bestGap = gap;
    }
  }
  return best;
}

/** The guide of the gap between two rects on the axis, drawn at the middle of their overlap on the other axis. */
function gapGuide(first: DeckRect, second: DeckRect, axis: "x" | "y"): SnapGuide {
  const band = overlap(across(first, axis), across(second, axis)) ?? across(first, axis);
  return { axis, kind: "spacing", from: round2(along(first, axis).end), to: round2(along(second, axis).start), at: round2((band.start + band.end) / 2) };
}

/** The rect with its start on the axis moved to `at`. */
const placed = (rect: DeckRect, axis: "x" | "y", at: number): DeckRect => (axis === "x" ? { ...rect, left: at } : { ...rect, top: at });

/**
 * The starts on the axis that give the rect equal spacing, each with its guides: first the between case (equal gaps to the
 * nearest blocks before and after), then the chain cases (the gap of the pair before, then of the pair after).
 */
export function spacingTargets(rect: DeckRect, axis: "x" | "y", others: readonly DeckRect[]): { at: number; guides: SnapGuide[] }[] {
  const size = axis === "x" ? rect.width : rect.height;
  const prev = neighbour(rect, axis, others, -1);
  const next = neighbour(rect, axis, others, 1);
  const targets: { at: number; guides: SnapGuide[] }[] = [];
  if (prev && next) {
    const at = (along(prev, axis).end + along(next, axis).start - size) / 2;
    const moved = placed(rect, axis, at);
    targets.push({ at, guides: [gapGuide(prev, moved, axis), gapGuide(moved, next, axis)] });
  }
  const before = prev && neighbour(prev, axis, others, -1);
  if (prev && before) {
    const at = along(prev, axis).end + (along(prev, axis).start - along(before, axis).end);
    const moved = placed(rect, axis, at);
    targets.push({ at, guides: [gapGuide(before, prev, axis), gapGuide(prev, moved, axis)] });
  }
  const after = next && neighbour(next, axis, others, 1);
  if (next && after) {
    const at = along(next, axis).start - (along(after, axis).start - along(next, axis).end) - size;
    const moved = placed(rect, axis, at);
    targets.push({ at, guides: [gapGuide(moved, next, axis), gapGuide(next, after, axis)] });
  }
  return targets;
}
