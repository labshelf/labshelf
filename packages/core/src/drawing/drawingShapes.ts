// Geometry of the drawing's shapes, computed once by the layout for every printer: node outlines around point labels and
// where an edge meets them, curves, regular polygons and stars, ellipses, arcs and sectors, angle marks (a square at a right
// angle) and the equal-length marks of a segment, all as paths in grid units (y up).
import type { DrawingModel, NodeShape, Vec } from "./drawingModel.js";
import { arcPath, ellipsePath, ngonVertices, polyPath, PX_PER_UNIT as PX, smoothPath, toDegrees as deg, type Path, type PathSeg } from "./drawingPath.js";

type DrawingItem = DrawingModel["items"][number];
type Measure = (tex: string) => { width: number; height: number };

/** A node's outline: its shape and half extents, in grid units. */
export interface NodeBox { shape: NodeShape; hw: number; hh: number }

/** What a shape item draws: its paths (stroked, filled when `fill`), arrowheads at the ends of its first path, and labels centred at points. */
export interface ShapeLayout { paths: Path[]; fill: boolean; arrow?: 'end' | 'both'; labels: Array<{ tex: string; at: Vec }> }

/** Space, in px, between a node's label and its outline, and the least half size of a node. */
const NODE_PAD_PX = 4;
const MIN_NODE_PX = 6;
/** Radius of an angle mark, gap between its arcs and side of a right-angle square, in grid units. */
const ANGLE_R = 0.8;
const ANGLE_STEP = 0.15;
const RIGHT_SIDE = 0.5;
/** A right angle within this many degrees is marked with a square. */
const RIGHT_TOLERANCE = 0.5;
/** Half length of an equal-length mark and the space between marks, in grid units. */
const MARK_HALF = 0.25;
const MARK_STEP = 0.15;
const LABEL_GAP_PX = 3;
const EPS = 1e-9;

export function nodeBox(shape: NodeShape, label: { width: number; height: number } | null): NodeBox {
  const w = (label?.width ?? 0) / 2;
  const h = (label?.height ?? 0) / 2;
  const fit = (v: number): number => Math.max(v, MIN_NODE_PX) / PX;
  switch (shape) {
    case "circle": { const r = fit(Math.hypot(w, h) + NODE_PAD_PX / 2); return { shape, hw: r, hh: r }; }
    case "ellipse": return { shape, hw: fit((w + NODE_PAD_PX / 2) * Math.SQRT2), hh: fit((h + NODE_PAD_PX / 2) * Math.SQRT2) };
    case "diamond": return { shape, hw: fit(2 * w + NODE_PAD_PX), hh: fit(2 * h + NODE_PAD_PX) };
    case "box": case "round": return { shape, hw: fit(w + NODE_PAD_PX), hh: fit(h + NODE_PAD_PX) };
  }
}

/** A rectangle with rounded corners around c. */
function roundedPath(c: Vec, hw: number, hh: number): Path {
  const r = Math.min(hw, hh) * 0.45;
  const corner = (x: number, y: number, from: number): PathSeg[] => arcPath({ x, y }, r, r, 0, from, from + 90).segs;
  const segs: PathSeg[] = [
    { k: "L", to: { x: c.x + hw, y: c.y + hh - r } }, ...corner(c.x + hw - r, c.y + hh - r, 0),
    { k: "L", to: { x: c.x - hw + r, y: c.y + hh } }, ...corner(c.x - hw + r, c.y + hh - r, 90),
    { k: "L", to: { x: c.x - hw, y: c.y - hh + r } }, ...corner(c.x - hw + r, c.y - hh + r, 180),
    { k: "L", to: { x: c.x + hw - r, y: c.y - hh } }, ...corner(c.x + hw - r, c.y - hh + r, 270),
  ];
  return { start: { x: c.x + hw, y: c.y - hh + r }, segs, closed: true };
}

export function nodePath(c: Vec, node: NodeBox): Path {
  const { hw, hh } = node;
  switch (node.shape) {
    case "circle": case "ellipse": return ellipsePath(c, hw, hh);
    case "box": return polyPath([{ x: c.x + hw, y: c.y - hh }, { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh }, { x: c.x - hw, y: c.y - hh }], true);
    case "round": return roundedPath(c, hw, hh);
    case "diamond": return polyPath([{ x: c.x + hw, y: c.y }, { x: c.x, y: c.y + hh }, { x: c.x - hw, y: c.y }, { x: c.x, y: c.y - hh }], true);
  }
}

/** Distance from a node's centre to its outline along the unit direction (ux, uy). */
export function nodeBoundary(node: NodeBox, ux: number, uy: number): number {
  const { hw, hh } = node;
  switch (node.shape) {
    case "circle": case "ellipse": return 1 / Math.hypot(ux / hw, uy / hh);
    case "diamond": return 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh);
    case "box": case "round": return Math.min(Math.abs(ux) < EPS ? Infinity : hw / Math.abs(ux), Math.abs(uy) < EPS ? Infinity : hh / Math.abs(uy));
  }
}

/** `count` short strokes across a segment at `mid`, the segment running along the unit direction u. */
export function segmentMarks(mid: Vec, u: Vec, count: number): Path[] {
  const normal = { x: -u.y, y: u.x };
  return Array.from({ length: count }, (_unused, k) => {
    const off = (k - (count - 1) / 2) * MARK_STEP;
    const at = { x: mid.x + u.x * off, y: mid.y + u.y * off };
    return polyPath([{ x: at.x - normal.x * MARK_HALF, y: at.y - normal.y * MARK_HALF }, { x: at.x + normal.x * MARK_HALF, y: at.y + normal.y * MARK_HALF }], false);
  });
}

/** The angle mark at o between the rays to a and b, on the side of the angle under 180°. */
function angleShape(item: Extract<DrawingItem, { k: 'angle' }>, a: Vec, o: Vec, b: Vec, measure: Measure): ShapeLayout | null {
  const la = Math.hypot(a.x - o.x, a.y - o.y);
  const lb = Math.hypot(b.x - o.x, b.y - o.y);
  if (la < EPS || lb < EPS) { return null; }
  let start = Math.atan2(a.y - o.y, a.x - o.x);
  let sweep = Math.atan2(b.y - o.y, b.x - o.x) - start;
  sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (sweep > Math.PI) { start += sweep; sweep = 2 * Math.PI - sweep; }
  if (sweep < EPS) { return null; }
  const r = item.r ?? ANGLE_R;
  const fill = item.style?.fill !== undefined;
  const ua = { x: Math.cos(start), y: Math.sin(start) };
  const ub = { x: Math.cos(start + sweep), y: Math.sin(start + sweep) };
  let paths: Path[];
  if (Math.abs(deg(sweep) - 90) < RIGHT_TOLERANCE) {
    const s = Math.min(r, RIGHT_SIDE);
    const corner = { x: o.x + (ua.x + ub.x) * s, y: o.y + (ua.y + ub.y) * s };
    const square = [{ x: o.x + ua.x * s, y: o.y + ua.y * s }, corner, { x: o.x + ub.x * s, y: o.y + ub.y * s }];
    paths = [fill ? polyPath([o, ...square], true) : polyPath(square, false)];
  } else {
    paths = Array.from({ length: item.arcs ?? 1 }, (_unused, k) => arcPath(o, r + k * ANGLE_STEP, r + k * ANGLE_STEP, 0, deg(start), deg(start + sweep)));
    if (fill && paths[0]) { paths[0] = { start: o, segs: [{ k: "L", to: paths[0].start }, ...paths[0].segs, { k: "L", to: o }], closed: true }; }
  }
  const labels: ShapeLayout["labels"] = [];
  if (item.label) {
    const mid = start + sweep / 2;
    const u = { x: Math.cos(mid), y: Math.sin(mid) };
    const box = measure(item.label);
    const reach = r + ((item.arcs ?? 1) - 1) * ANGLE_STEP + (Math.abs(u.x) * box.width / 2 + Math.abs(u.y) * box.height / 2 + LABEL_GAP_PX) / PX;
    labels.push({ tex: item.label, at: { x: o.x + u.x * reach, y: o.y + u.y * reach } });
  }
  return { paths, fill, labels };
}

/** An arc, closed into a sector through its centre or by its chord. */
function arcShape(item: Extract<DrawingItem, { k: 'arc' }>, c: Vec): ShapeLayout {
  const arc = arcPath(c, item.r, item.r, 0, item.from, item.to);
  const fill = item.close !== undefined && item.style?.fill !== undefined;
  if (item.close === "sector") { return { paths: [{ start: c, segs: [{ k: "L", to: arc.start }, ...arc.segs, { k: "L", to: c }], closed: true }], fill, labels: [] }; }
  if (item.close === "chord") { return { paths: [{ ...arc, segs: [...arc.segs, { k: "L", to: arc.start }], closed: true }], fill, labels: [] }; }
  return { paths: [arc], fill: false, ...(item.arrow ? { arrow: item.arrow } : {}), labels: [] };
}

/** The shape of a curve, regular polygon, ellipse, arc or angle mark; null for other kinds or when a point it names is missing. */
export function itemShape(item: DrawingItem, at: (id: string) => Vec | undefined, measure: Measure): ShapeLayout | null {
  const filled = "style" in item && item.style?.fill !== undefined;
  switch (item.k) {
    case "curve": {
      const pts = item.pts.map(at);
      if (!pts.every((p): p is Vec => p !== undefined)) { return null; }
      const path = smoothPath(pts, item.closed, item.ctrl);
      return { paths: [path], fill: filled && path.closed, ...(item.arrow && !path.closed ? { arrow: item.arrow } : {}), labels: [] };
    }
    case "ngon": {
      const c = at(item.c);
      return c ? { paths: [polyPath(ngonVertices(c, item.r, item.n, item.rot, item.star), true)], fill: filled, labels: [] } : null;
    }
    case "ellipse": {
      const c = at(item.c);
      return c ? { paths: [ellipsePath(c, item.rx, item.ry, item.rot ?? 0)], fill: filled, labels: [] } : null;
    }
    case "arc": {
      const c = at(item.c);
      return c ? arcShape(item, c) : null;
    }
    case "angle": {
      const [a, o, b] = [at(item.a), at(item.o), at(item.b)];
      return a && o && b ? angleShape(item, a, o, b, measure) : null;
    }
    default:
      return null;
  }
}
