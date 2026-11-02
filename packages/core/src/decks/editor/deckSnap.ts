// Deck block snapping (D8): slide edges and centre, other blocks' edges and centres within 6 screen px, else the 8 px grid.
import type { DeckRect } from "../deckParse.js";

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

interface SnapGuide { axis: "x" | "y"; at: number; from: number; to: number }

export interface DeckSnapInput { rect: DeckRect; moving: "move" | ResizeHandle; others: readonly DeckRect[]; canvas: { width: number; height: number }; scale: number; disabled?: boolean }

export interface DeckSnapResult { rect: DeckRect; guides: SnapGuide[] }

const SNAP_SCREEN_PX = 6;
const GRID_PX = 8;
const MIN_SIZE_PX = 8;

/** The edges of one axis: start (left or top), centre and end (right or bottom). */
type Edge = "start" | "centre" | "end";

interface AxisTarget { at: number; other: DeckRect | null }

interface AxisSnap { edge: Edge; target: AxisTarget }

const round2 = (value: number): number => Math.round(value * 100) / 100;

const roundRect = (rect: DeckRect): DeckRect => ({ left: round2(rect.left), top: round2(rect.top), width: round2(rect.width), height: round2(rect.height) });

/** Snaps a moved or resized rect in slide px; never mutates the input. */
export function snapDeckRect(input: DeckSnapInput): DeckSnapResult {
  if (input.disabled) return { rect: roundRect(input.rect), guides: [] };
  const threshold = SNAP_SCREEN_PX / input.scale;
  const { rect, moving, others, canvas } = input;

  const xEdges = movingEdges(moving, "w", "e");
  const yEdges = movingEdges(moving, "n", "s");
  const xTargets = axisTargets(canvas.width, others, (other) => [other.left, other.width]);
  const yTargets = axisTargets(canvas.height, others, (other) => [other.top, other.height]);
  const xSnap = nearest(rect.left, rect.width, xEdges, xTargets, threshold);
  const ySnap = nearest(rect.top, rect.height, yEdges, yTargets, threshold);

  const [left, width] = applyAxis(rect.left, rect.width, moving === "move", xEdges, xSnap);
  const [top, height] = applyAxis(rect.top, rect.height, moving === "move", yEdges, ySnap);
  const snapped: DeckRect = { left, top, width, height };

  const guides: SnapGuide[] = [];
  if (xSnap) guides.push(guide("x", xSnap.target, snapped.top, snapped.top + snapped.height, canvas.height, (other) => [other.top, other.top + other.height]));
  if (ySnap) guides.push(guide("y", ySnap.target, snapped.left, snapped.left + snapped.width, canvas.width, (other) => [other.left, other.left + other.width]));
  return { rect: roundRect(snapped), guides };
}

/** The edges a gesture moves on one axis: all three for a move, else the start or end edge its handle names. */
function movingEdges(moving: "move" | ResizeHandle, startLetter: string, endLetter: string): Edge[] {
  if (moving === "move") return ["start", "centre", "end"];
  const edges: Edge[] = [];
  if (moving.includes(startLetter)) edges.push("start");
  if (moving.includes(endLetter)) edges.push("end");
  return edges;
}

function axisTargets(extent: number, others: readonly DeckRect[], span: (other: DeckRect) => [number, number]): AxisTarget[] {
  const targets: AxisTarget[] = [{ at: 0, other: null }, { at: extent / 2, other: null }, { at: extent, other: null }];
  for (const other of others) {
    const [start, size] = span(other);
    targets.push({ at: start, other }, { at: start + size / 2, other }, { at: start + size, other });
  }
  return targets;
}

function edgeAt(start: number, size: number, edge: Edge): number {
  if (edge === "start") return start;
  return edge === "centre" ? start + size / 2 : start + size;
}

/** The closest (edge, target) pair within the threshold; ties go to the earlier target, then the earlier edge. */
function nearest(start: number, size: number, edges: readonly Edge[], targets: readonly AxisTarget[], threshold: number): AxisSnap | null {
  let best: (AxisSnap & { distance: number }) | null = null;
  for (const target of targets) {
    for (const edge of edges) {
      const distance = Math.abs(edgeAt(start, size, edge) - target.at);
      if (distance <= threshold && (best === null || distance < best.distance)) best = { edge, target, distance };
    }
  }
  return best && { edge: best.edge, target: best.target };
}

/** Applies a snap (or the grid) to one axis; gives [start, size]. */
function applyAxis(start: number, size: number, isMove: boolean, edges: readonly Edge[], snap: AxisSnap | null): [number, number] {
  if (isMove) {
    if (snap) return [start + snap.target.at - edgeAt(start, size, snap.edge), size];
    return [toGrid(start), size];
  }
  let nextStart = start;
  let end = start + size;
  for (const edge of edges) {
    const at = snap && snap.edge === edge ? snap.target.at : snap ? edgeAt(start, size, edge) : toGrid(edgeAt(start, size, edge));
    if (edge === "start") nextStart = at;
    else end = at;
  }
  if (end - nextStart >= MIN_SIZE_PX) return [nextStart, end - nextStart];
  return edges.includes("start") && !edges.includes("end") ? [end - MIN_SIZE_PX, MIN_SIZE_PX] : [nextStart, MIN_SIZE_PX];
}

const toGrid = (value: number): number => Math.round(value / GRID_PX) * GRID_PX;

function guide(axis: "x" | "y", target: AxisTarget, from: number, to: number, extent: number, span: (other: DeckRect) => [number, number]): SnapGuide {
  if (!target.other) return { axis, at: round2(target.at), from: 0, to: extent };
  const [otherFrom, otherTo] = span(target.other);
  return { axis, at: round2(target.at), from: round2(Math.min(from, otherFrom)), to: round2(Math.max(to, otherTo)) };
}
