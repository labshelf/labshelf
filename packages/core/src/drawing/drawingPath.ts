// Paths of straight and cubic pieces in grid units (y up): the one geometry the SVG and TikZ printers and the editor's hit
// testing share for curves, regular polygons, ellipses, arcs, angle marks and node outlines. Arcs are cubic Béziers (at most
// 90° each), so the PDF draws exactly what the screen shows and no TikZ library is needed.
import type { Vec } from "./drawingModel.js";

export type PathSeg = { k: 'L'; to: Vec } | { k: 'C'; c1: Vec; c2: Vec; to: Vec };

/** A path from `start` through `segs`; a closed path's last piece returns to `start` (printers write it as a close). */
export interface Path { start: Vec; segs: PathSeg[]; closed: boolean }

/** Control points of one cubic piece, relative to the piece's start and end points. */
export type Ctrl = [number, number, number, number];

/** Measured label boxes are in CSS pixels; one grid unit is 0.5cm (the TikZ header's x and y) at 96 px per inch. */
export const PX_PER_UNIT = (0.5 / 2.54) * 96;

const DEG = Math.PI / 180;

/** Radians as degrees. */
export const toDegrees = (rad: number): number => rad / DEG;
/** An angle in degrees turned into [0, 360). */
export const turnDegrees = (deg: number): number => ((deg % 360) + 360) % 360;
/** Cubic Bézier factor for a quarter circle, scaled per arc span. */
const kappa = (span: number): number => (4 / 3) * Math.tan(span / 4);

export const addVec = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

export function polyPath(pts: readonly Vec[], closed: boolean): Path {
  const [first, ...rest] = pts;
  const segs: PathSeg[] = rest.map((to) => ({ k: "L", to }));
  if (closed && first && pts.length > 2) { segs.push({ k: "L", to: first }); }
  return { start: first ?? { x: 0, y: 0 }, segs, closed: closed && pts.length > 2 };
}

/** The point at angle `a` (radians) of the ellipse (c, rx, ry) turned by `rot` radians. */
function onEllipse(c: Vec, rx: number, ry: number, rot: number, a: number): Vec {
  const x = rx * Math.cos(a);
  const y = ry * Math.sin(a);
  return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) };
}

/** The derivative direction at angle `a`, scaled by the radii. */
function tangentOf(rx: number, ry: number, rot: number, a: number): Vec {
  const x = -rx * Math.sin(a);
  const y = ry * Math.cos(a);
  return { x: x * Math.cos(rot) - y * Math.sin(rot), y: x * Math.sin(rot) + y * Math.cos(rot) };
}

/** The elliptic arc from angle `from` to `to` (degrees, counter-clockwise when to > from) as cubic pieces of at most 90°. */
export function arcPath(c: Vec, rx: number, ry: number, rotDeg: number, from: number, to: number): Path {
  const rot = rotDeg * DEG;
  const a0 = from * DEG;
  const sweep = (to - from) * DEG;
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const k = kappa(step);
  const segs: PathSeg[] = [];
  for (let i = 0; i < pieces; i++) {
    const s = a0 + i * step;
    const e = s + step;
    const p0 = onEllipse(c, rx, ry, rot, s);
    const p1 = onEllipse(c, rx, ry, rot, e);
    const t0 = tangentOf(rx, ry, rot, s);
    const t1 = tangentOf(rx, ry, rot, e);
    segs.push({ k: "C", c1: { x: p0.x + k * t0.x, y: p0.y + k * t0.y }, c2: { x: p1.x - k * t1.x, y: p1.y - k * t1.y }, to: p1 });
  }
  return { start: onEllipse(c, rx, ry, rot, a0), segs, closed: false };
}

export function ellipsePath(c: Vec, rx: number, ry: number): Path {
  return { ...arcPath(c, rx, ry, 0, 0, 360), closed: true };
}

/** The automatic control points of a smooth curve through `pts` (Catmull-Rom, the ends held), relative to each piece's ends. */
function autoCtrl(pts: readonly Vec[], closed: boolean, i: number): Ctrl {
  const count = pts.length;
  const at = (j: number): Vec => pts[closed ? ((j % count) + count) % count : Math.min(count - 1, Math.max(0, j))]!;
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return [(p2.x - p0.x) / 6, (p2.y - p0.y) / 6, -(p3.x - p1.x) / 6, -(p3.y - p1.y) / 6];
}

/** Absolute control points of every piece of a smooth curve: `ctrl[i]` when set, else the automatic ones. */
export function curveControls(pts: readonly Vec[], closed: boolean, ctrl?: ReadonlyArray<Ctrl | null>): Array<{ from: Vec; c1: Vec; c2: Vec; to: Vec }> {
  const pieces = closed ? pts.length : pts.length - 1;
  const out: Array<{ from: Vec; c1: Vec; c2: Vec; to: Vec }> = [];
  for (let i = 0; i < pieces; i++) {
    const from = pts[i]!;
    const to = pts[(i + 1) % pts.length]!;
    const [ax, ay, bx, by] = ctrl?.[i] ?? autoCtrl(pts, closed, i);
    out.push({ from, c1: addVec(from, { x: ax, y: ay }), c2: addVec(to, { x: bx, y: by }), to });
  }
  return out;
}

export function smoothPath(pts: readonly Vec[], closed: boolean, ctrl?: ReadonlyArray<Ctrl | null>): Path {
  const isClosed = closed && pts.length > 2;
  const segs = curveControls(pts, isClosed, ctrl).map(({ c1, c2, to }): PathSeg => ({ k: "C", c1, c2, to }));
  return { start: pts[0] ?? { x: 0, y: 0 }, segs, closed: isClosed };
}

/** The vertices of a regular polygon (or a star, with `inner` the inner radius as a share of `r`), the first at `rot` degrees. */
export function ngonVertices(c: Vec, r: number, n: number, rotDeg: number, inner?: number): Vec[] {
  const out: Vec[] = [];
  const corners = inner === undefined ? n : 2 * n;
  for (let i = 0; i < corners; i++) {
    const radius = inner !== undefined && i % 2 === 1 ? r * inner : r;
    const a = rotDeg * DEG + (2 * Math.PI * i) / corners;
    out.push({ x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a) });
  }
  return out;
}

// ---- affine maps ----

/** A 2×2 matrix [a, b, c, d] mapping (x, y) to (a x + b y, c x + d y). */
export type Mat2 = [number, number, number, number];

/** How a shape is turned (degrees, counter-clockwise), slanted (degrees, along its own x) and stretched about its centre. */
export interface ShapeTransform { rot?: number; skew?: number; sx?: number; sy?: number }

export const IDENTITY: Mat2 = [1, 0, 0, 1];

export function mulMat(m: Mat2, n: Mat2): Mat2 {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3]];
}

export function applyMat(m: Mat2, v: Vec): Vec {
  return { x: m[0] * v.x + m[1] * v.y, y: m[2] * v.x + m[3] * v.y };
}

export function invertMat(m: Mat2): Mat2 | null {
  const det = m[0] * m[3] - m[1] * m[2];
  return Math.abs(det) < 1e-12 ? null : [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

/** The matrix of a transform: turn × slant × stretch. */
export function transformMatrix(tf: ShapeTransform | undefined): Mat2 {
  if (!tf) { return IDENTITY; }
  const r = (tf.rot ?? 0) * DEG;
  const k = Math.tan((tf.skew ?? 0) * DEG);
  const sx = tf.sx ?? 1;
  const sy = tf.sy ?? 1;
  return mulMat([Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r)], [sx, k * sy, 0, sy]);
}

/** The transform of a matrix (its QR factors: a turn times an upper triangle), the inverse of transformMatrix. */
export function matrixTransform(m: Mat2): ShapeTransform {
  const sx = Math.hypot(m[0], m[2]);
  const rot = Math.atan2(m[2], m[0]);
  const [c, s] = [Math.cos(rot), Math.sin(rot)];
  const t = c * m[1] + s * m[3];
  const sy = -s * m[1] + c * m[3];
  return { rot: toDegrees(rot), skew: sy === 0 ? 0 : toDegrees(Math.atan(t / sy)), sx, sy };
}

/** The path with every point (ends and control points) mapped by m about c; exact for cubic pieces. */
export function mapPath(path: Path, c: Vec, m: Mat2): Path {
  if (m === IDENTITY) { return path; }
  const f = (v: Vec): Vec => { const w = applyMat(m, { x: v.x - c.x, y: v.y - c.y }); return { x: c.x + w.x, y: c.y + w.y }; };
  return { start: f(path.start), closed: path.closed, segs: path.segs.map((seg): PathSeg => (seg.k === "L" ? { k: "L", to: f(seg.to) } : { k: "C", c1: f(seg.c1), c2: f(seg.c2), to: f(seg.to) })) };
}

const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cubicAt(p0: Vec, c1: Vec, c2: Vec, p1: Vec, t: number): Vec {
  const a = lerp(p0, c1, t);
  const b = lerp(c1, c2, t);
  const c = lerp(c2, p1, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

/** The path as a polyline, each cubic piece cut in `steps`: for bounds and hit testing. */
export function flattenPath(path: Path, steps = 16): Vec[] {
  const out: Vec[] = [path.start];
  let at = path.start;
  for (const seg of path.segs) {
    if (seg.k === "L") { out.push(seg.to); } else {
      for (let i = 1; i <= steps; i++) { out.push(cubicAt(at, seg.c1, seg.c2, seg.to, i / steps)); }
    }
    at = seg.to;
  }
  return out;
}

/** The end of the path and a point behind it along its last direction (where an arrowhead points from). */
export function pathEnd(path: Path): { tip: Vec; from: Vec } {
  const last = path.segs[path.segs.length - 1];
  if (!last) { return { tip: path.start, from: path.start }; }
  const before = path.segs[path.segs.length - 2]?.to ?? path.start;
  return { tip: last.to, from: last.k === "C" && (last.c2.x !== last.to.x || last.c2.y !== last.to.y) ? last.c2 : before };
}

/** The start of the path and a point ahead of it along its first direction. */
export function pathStart(path: Path): { tip: Vec; from: Vec } {
  const first = path.segs[0];
  if (!first) { return { tip: path.start, from: path.start }; }
  return { tip: path.start, from: first.k === "C" && (first.c1.x !== path.start.x || first.c1.y !== path.start.y) ? first.c1 : first.to };
}
