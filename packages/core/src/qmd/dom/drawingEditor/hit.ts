// Hit testing of the drawing editor, pure and in grid units (y up): what is under a position in the drawing last rendered.
// The selected item's own handles come first, then the nearest point (a node: anywhere inside its outline), then the
// selection's transform box handles, then the nearest item outline, then the inside of a closed shape, then the axes whose
// box holds the position.
import { flattenPath, nodeBoundary, PX_PER_UNIT as PX, type DrawingLayout, type DrawingModel, type LabelBox, type Vec } from "../../../drawing/index.js";
import { handleItem, selectionHandles } from "./handles.js";
import type { EditorState, HitTarget } from "./state.js";

/** Pointer distance, in px, within which a point, a handle or an item is under the pointer. */
const HIT_PX = 8;

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolyline(p: Vec, pts: Vec[], closed: boolean): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) { best = Math.min(best, distToSegment(p, pts[i]!, pts[i + 1]!)); }
  if (closed && pts.length > 2) { best = Math.min(best, distToSegment(p, pts[pts.length - 1]!, pts[0]!)); }
  return best;
}

function corners(a: Vec, b: Vec): Vec[] {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
}

/** Distance from `at` to the paths the layout gave the item. */
function distToShape(layout: DrawingLayout, index: number, at: Vec): number {
  let best = Infinity;
  for (const path of layout.shapes.get(index)?.paths ?? []) { best = Math.min(best, distToPolyline(at, flattenPath(path), false)); }
  return best;
}

/** Distance from `at` to the axis lines and the box of the axes `id`. */
function distToAxes(layout: DrawingLayout, id: string, at: Vec): number {
  const axes = layout.axes.get(id);
  if (!axes) { return Infinity; }
  const crossX = Math.min(axes.to.x, Math.max(axes.from.x, axes.origin.x));
  const crossY = Math.min(axes.to.y, Math.max(axes.from.y, axes.origin.y));
  return Math.min(
    distToSegment(at, { x: axes.from.x, y: crossY }, { x: axes.to.x, y: crossY }),
    distToSegment(at, { x: crossX, y: axes.from.y }, { x: crossX, y: axes.to.y }),
    distToPolyline(at, corners(axes.from, axes.to), true),
  );
}

/** Distance, in grid units, from `at` to the item's outline, or Infinity when the item cannot be placed. */
function distToItem(model: DrawingModel, layout: DrawingLayout, index: number, at: Vec, measure: (tex: string) => LabelBox): number {
  const item = model.items[index];
  if (!item) { return Infinity; }
  const byId = (id: string): Vec | undefined => model.points.find((p) => p.id === id);
  switch (item.k) {
    case "seg": {
      const a = byId(item.a);
      const b = byId(item.b);
      return a && b ? distToSegment(at, a, b) : Infinity;
    }
    case "circle": {
      if (layout.shapes.has(index)) { return distToShape(layout, index, at); }
      const c = byId(item.c);
      return c ? Math.abs(Math.hypot(at.x - c.x, at.y - c.y) - item.r) : Infinity;
    }
    case "rect": {
      const a = byId(item.a);
      const b = byId(item.b);
      return a && b ? distToPolyline(at, corners(a, b), true) : Infinity;
    }
    case "poly": {
      const pts = item.pts.map(byId);
      return pts.every((p): p is Vec => p !== undefined) ? distToPolyline(at, pts, item.closed) : Infinity;
    }
    case "curve": case "ngon": case "ellipse": case "arc": case "angle":
      return distToShape(layout, index, at);
    case "text": {
      const box = measure(item.tex);
      const dx = Math.max(0, Math.abs(at.x - item.x) - box.width / 2 / PX);
      const dy = Math.max(0, Math.abs(at.y - item.y) - box.height / 2 / PX);
      return Math.hypot(dx, dy);
    }
    case "axes":
      return distToAxes(layout, item.id, at);
    case "fn": {
      let best = Infinity;
      for (const run of layout.curves.get(index) ?? []) { best = Math.min(best, distToPolyline(at, run, false)); }
      return best;
    }
  }
}

/** Whether `at` lies inside the closed polygon `pts` (even-odd). */
function insidePolygon(at: Vec, pts: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if ((a.y > at.y) !== (b.y > at.y) && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) { inside = !inside; }
  }
  return inside;
}

/** Whether `at` lies inside the item's closed outline: a circle, rectangle, closed polygon or any closed path of its shape. */
function insideItem(model: DrawingModel, layout: DrawingLayout, index: number, at: Vec): boolean {
  const item = model.items[index];
  const byId = (id: string): Vec | undefined => model.points.find((p) => p.id === id);
  const closedPaths = (layout.shapes.get(index)?.paths ?? []).filter((path) => path.closed);
  if (closedPaths.some((path) => insidePolygon(at, flattenPath(path)))) { return true; }
  switch (item?.k) {
    case "circle": { const c = byId(item.c); return !layout.shapes.has(index) && c !== undefined && Math.hypot(at.x - c.x, at.y - c.y) < item.r; }
    case "rect": { const [a, b] = [byId(item.a), byId(item.b)]; return a !== undefined && b !== undefined && insidePolygon(at, corners(a, b)); }
    case "poly": { const pts = item.pts.map(byId); return item.closed && pts.every((p): p is Vec => p !== undefined) && insidePolygon(at, pts); }
    default: return false;
  }
}

function asTarget(model: DrawingModel, index: number): HitTarget | undefined {
  const item = model.items[index];
  if (!item) { return undefined; }
  return item.k === "axes" ? { kind: "axes", id: item.id, index } : { kind: "item", index };
}

/** The handle within the tolerance, Select tool only: the selected item's own (index: the item) when `own`, else the transform box's (index -1). */
function hitHandle(state: EditorState, at: Vec, tol: number, own: boolean): HitTarget | null {
  const handle = selectionHandles(state).find((h) => h.id.startsWith("t:") !== own && Math.hypot(h.at.x - at.x, h.at.y - at.y) <= tol);
  return handle ? { kind: "handle", index: own ? handleItem(state) ?? -1 : -1, handle: handle.id } : null;
}

/** A point's distance to `at`; a node's is 0 inside its outline and its distance from the outline outside. */
function distToPoint(p: Vec & { id: string }, layout: DrawingLayout, at: Vec): number {
  const d = Math.hypot(p.x - at.x, p.y - at.y);
  const node = layout.nodes.get(p.id);
  return node && d > 0 ? Math.max(0, d - nodeBoundary(node, (at.x - p.x) / d, (at.y - p.y) / d)) : d;
}

export function hitTest(state: EditorState, layout: DrawingLayout, at: Vec, scale: number, measure: (tex: string) => LabelBox): HitTarget | null {
  const model = state.model;
  const tol = HIT_PX / scale;
  const handle = hitHandle(state, at, tol, true);
  if (handle) { return handle; }
  let bestPoint: { id: string; d: number } | undefined;
  for (const p of model.points) {
    const d = distToPoint(p, layout, at);
    if (d <= tol && (!bestPoint || d < bestPoint.d)) { bestPoint = { id: p.id, d }; }
  }
  if (bestPoint) { return { kind: "point", id: bestPoint.id }; }
  const boxHandle = hitHandle(state, at, tol, false);
  if (boxHandle) { return boxHandle; }
  let best: { index: number; d: number } | undefined;
  model.items.forEach((_item, index) => {
    const d = distToItem(model, layout, index, at, measure);
    if (d <= tol && (!best || d < best.d)) { best = { index, d }; }
  });
  const target = best === undefined ? undefined : asTarget(model, best.index);
  if (target) { return target; }
  // Inside a closed shape counts too, the topmost first, after every outline (so a line drawn over a shape stays reachable).
  for (let index = model.items.length - 1; index >= 0; index--) {
    if (insideItem(model, layout, index, at)) { return asTarget(model, index) ?? null; }
  }
  for (let index = model.items.length - 1; index >= 0; index--) {
    const item = model.items[index];
    const axes = item?.k === "axes" ? layout.axes.get(item.id) : undefined;
    if (item?.k === "axes" && axes && at.x >= Math.min(axes.from.x, axes.to.x) && at.x <= Math.max(axes.from.x, axes.to.x) && at.y >= Math.min(axes.from.y, axes.to.y) && at.y <= Math.max(axes.from.y, axes.to.y)) {
      return { kind: "axes", id: item.id, index };
    }
  }
  return null;
}
