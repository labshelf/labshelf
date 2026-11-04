// The transform box of the selection, as pure functions in grid units (y up): side and corner handles stretch it (the
// opposite side stays; Shift keeps the proportions of a corner drag), a round handle above it turns it (Shift: by 15°), a
// slant handle below it slants it. A single shape drawn around a centre (circle, ellipse, regular polygon, arc) keeps the
// change in its own transform; everything else takes it into its points, and a rectangle that turns or slants becomes a
// polygon.
import { addVec as add, applyMat, centredBox, invertMat, isCentred, matrixTransform, mulMat, transformMatrix, turnDegrees, type DrawingModel, type Mat2, type ShapeTransform, type Vec } from "../../../drawing/index.js";
import { pointById as pointAt, r2, reflow, selectedItemIndexes, selectedPointIds, type EditorState, type IdSource, type Item, type Point } from "./state.js";

/** The box a selection is transformed by: its centre and the half-extent vectors of its own x and y. */
export interface Frame { c: Vec; u: Vec; v: Vec }

/** A world map p → o + m (p − o). */
export interface Affine { m: Mat2; o: Vec }

type HandleKind = 'point' | 'scale' | 'rotate' | 'skew';

/** A handle at `at`; `base` is the point a guide line joins it to (a control point's anchor, a radius's centre). */
export interface Handle { id: string; at: Vec; kind: HandleKind; base?: Vec }

/** The least half size a box gets along a flat side, and how far, in grid units, the turn and slant handles sit outside it. */
const MIN_HALF = 0.25;
const ROTATE_REACH = 1.2;
const SKEW_REACH = 0.8;
/** The least share a stretch keeps, so a shape never collapses to a line. */
const MIN_FACTOR = 0.05;
const MAX_SHEAR = 5;
const ANGLE_STEP = 15;

const scaled = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const unit = (a: Vec): Vec => scaled(a, 1 / (Math.hypot(a.x, a.y) || 1));

/** The columns u, v as a matrix: local (s, t) → s u + t v. */
const frameMatrix = (f: Frame): Mat2 => [f.u.x, f.v.x, f.u.y, f.v.y];

/** A centred item's own box: its centre and its transformed half axes. */
function centredFrame(model: DrawingModel, item: Item): Frame | null {
  if (!isCentred(item)) { return null; }
  const c = pointAt(model, item.c);
  if (!c) { return null; }
  const m = transformMatrix(item.tf);
  const { hw, hh } = centredBox(item);
  return { c: { x: c.x, y: c.y }, u: applyMat(m, { x: hw, y: 0 }), v: applyMat(m, { x: 0, y: hh }) };
}

/** The box of the selection: a single centred item's own turned box, else the upright box around everything selected; null
 * when there is nothing to transform, and for a single segment or curve, which are shaped by their points and handles. */
export function selectionFrame(state: EditorState): Frame | null {
  const model = state.model;
  const items = selectedItemIndexes(state);
  const only = state.selection.size === 1 && items.size === 1 ? model.items[[...items][0]!] : undefined;
  if (only?.k === "seg" || only?.k === "curve") { return null; }
  const own = only ? centredFrame(model, only) : null;
  if (own) { return own; }
  const box = selectionBox(state);
  if (!box || (box.x1 - box.x0 < 1e-9 && box.y1 - box.y0 < 1e-9)) { return null; }
  return { c: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, u: { x: Math.max((box.x1 - box.x0) / 2, MIN_HALF), y: 0 }, v: { x: 0, y: Math.max((box.y1 - box.y0) / 2, MIN_HALF) } };
}

/** The upright box around the selection: its points, the points its items name, the turned boxes of its centred items and its labels; null with fewer than two such places. */
export function selectionBox(state: EditorState): { x0: number; x1: number; y0: number; y1: number } | null {
  const model = state.model;
  const pts: Vec[] = [...selectedPointIds(state)].flatMap((id) => { const p = pointAt(model, id); return p ? [p] : []; });
  for (const index of selectedItemIndexes(state)) {
    const item = model.items[index]!;
    const f = centredFrame(model, item);
    if (f) { pts.push(...frameCorners(f)); }
    if (item.k === "text") { pts.push(item); }
  }
  if (pts.length < 2) { return null; }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** The frame's corners in drawing order, for its outline. */
export function frameCorners(f: Frame): Vec[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => add(f.c, add(scaled(f.u, s!), scaled(f.v, t!))));
}

/** Eight stretch handles on the sides and corners, the turn handle above the top and the slant handle below the bottom left corner. */
export function frameHandles(f: Frame): Handle[] {
  const out: Handle[] = [];
  for (const s of [-1, 0, 1]) {
    for (const t of [-1, 0, 1]) {
      if (s !== 0 || t !== 0) { out.push({ id: `t:${s},${t}`, at: add(f.c, add(scaled(f.u, s), scaled(f.v, t))), kind: "scale" }); }
    }
  }
  const top = add(f.c, f.v);
  out.push({ id: "t:rot", at: add(top, scaled(unit(f.v), ROTATE_REACH)), kind: "rotate", base: top });
  out.push({ id: "t:skew", at: add(add(f.c, scaled(f.u, -1)), add(scaled(f.v, -1), scaled(unit(f.v), -SKEW_REACH))), kind: "skew" });
  return out;
}

/** A stretch factor, never smaller than MIN_FACTOR. */
const factor = (k: number): number => (Math.abs(k) < MIN_FACTOR ? (k < 0 ? -MIN_FACTOR : MIN_FACTOR) : k);

/** The map dragging the frame handle `id` to `to` makes. */
export function frameAffine(f: Frame, id: string, to: Vec, shift: boolean): Affine | null {
  const F = frameMatrix(f);
  const inv = invertMat(F);
  if (!inv) { return null; }
  const q = applyMat(inv, { x: to.x - f.c.x, y: to.y - f.c.y });
  const local = (L: Mat2, pivot: Vec): Affine => ({ m: mulMat(F, mulMat(L, inv)), o: add(f.c, applyMat(F, pivot)) });
  if (id === "t:rot") {
    let turn = Math.atan2(to.y - f.c.y, to.x - f.c.x) - Math.atan2(f.v.y, f.v.x);
    if (shift) { turn = (Math.round((turn * 180) / Math.PI / ANGLE_STEP) * ANGLE_STEP * Math.PI) / 180; }
    return { m: [Math.cos(turn), -Math.sin(turn), Math.sin(turn), Math.cos(turn)], o: f.c };
  }
  if (id === "t:skew") {
    const t0 = -1 - SKEW_REACH / (Math.hypot(f.v.x, f.v.y) || 1);
    const h = Math.max(-MAX_SHEAR, Math.min(MAX_SHEAR, (q.x + 1) / t0));
    return local([1, h, 0, 1], { x: 0, y: 0 });
  }
  const match = /^t:(-?\d),(-?\d)$/.exec(id);
  if (!match) { return null; }
  const s = Number(match[1]);
  const t = Number(match[2]);
  let kx = s === 0 ? 1 : factor((q.x + s) / (2 * s));
  let ky = t === 0 ? 1 : factor((q.y + t) / (2 * t));
  if (shift && s !== 0 && t !== 0) { kx = ky = Math.abs(kx) > Math.abs(ky) ? kx : ky; }
  return local([kx, 0, 0, ky], { x: -s, y: -t });
}

// ---- applying a map to the selection ----

/** A transform rounded as the model stores it, without its neutral parts, the turn in (-180, 180]. */
function cleanTransform(tf: ShapeTransform): ShapeTransform | undefined {
  const rot = r2(180 - turnDegrees(180 - (tf.rot ?? 0)));
  const out: ShapeTransform = {};
  if (rot !== 0) { out.rot = rot; }
  const skew = r2(tf.skew ?? 0);
  if (skew !== 0) { out.skew = Math.max(-85, Math.min(85, skew)); }
  const sx = r2(tf.sx ?? 1);
  const sy = r2(tf.sy ?? 1);
  if (sx !== 1) { out.sx = sx === 0 ? MIN_FACTOR : sx; }
  if (sy !== 1) { out.sy = sy === 0 ? MIN_FACTOR : sy; }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A centred item with the transform `tf` (cleaned, or removed when neutral). */
export function setTransform<T extends Item>(item: T, tf: ShapeTransform | undefined): T {
  const { tf: _old, ...rest } = item as T & { tf?: ShapeTransform };
  const clean = tf ? cleanTransform(tf) : undefined;
  return (clean ? { ...rest, tf: clean } : rest) as T;
}

/** The item after the map: a centred item composes it into its transform, a curve maps its set control points, a label moves, a rectangle that does not stay upright becomes a polygon through new corner points. */
function mapItem(item: Item, aff: Affine, map: (v: Vec) => Vec, model: DrawingModel, added: Point[], ids: IdSource): Item {
  const { m } = aff;
  if (isCentred(item)) { return setTransform(item, matrixTransform(mulMat(m, transformMatrix(item.tf)))); }
  switch (item.k) {
    case "curve":
      return item.ctrl ? { ...item, ctrl: item.ctrl.map((c) => { if (!c) { return null; } const a = applyMat(m, { x: c[0], y: c[1] }); const b = applyMat(m, { x: c[2], y: c[3] }); return [r2(a.x), r2(a.y), r2(b.x), r2(b.y)]; }) } : item;
    case "text": { const p = map(item); return { ...item, x: p.x, y: p.y }; }
    case "rect": {
      if (Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9) { return item; }
      const a = pointAt(model, item.a);
      const b = pointAt(model, item.b);
      if (!a || !b) { return item; }
      const corner = (x: number, y: number): string => { const p = map({ x, y }); const point: Point = { id: ids.take("p"), x: p.x, y: p.y, dot: false }; added.push(point); return point.id; };
      return { k: "poly", pts: [item.a, corner(b.x, a.y), item.b, corner(a.x, b.y)], closed: true, ...(item.style ? { style: item.style } : {}), ...(item.g ? { g: item.g } : {}) };
    }
    default:
      return item;
  }
}

/** The model with the map applied to the selection: its points (and the points its items name) move, its items follow. */
export function applyAffine(state: EditorState, aff: Affine, ids: IdSource): DrawingModel {
  const model = state.model;
  const map = (v: Vec): Vec => { const w = applyMat(aff.m, { x: v.x - aff.o.x, y: v.y - aff.o.y }); return { x: r2(aff.o.x + w.x), y: r2(aff.o.y + w.y) }; };
  const moved = selectedPointIds(state);
  const items = selectedItemIndexes(state);
  const added: Point[] = [];
  const nextItems = model.items.map((item, index) => (items.has(index) ? mapItem(item, aff, map, model, added, ids) : item));
  const points = model.points.map((p) => (moved.has(p.id) ? { ...p, ...map(p) } : p));
  return reflow({ ...model, points: [...points, ...added], items: nextItems });
}
