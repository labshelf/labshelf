// Gestures of the drawing tools as pure transitions, in grid units (y up): Polygon, Curve and Angle click their vertices one
// by one (a click on the first vertex closes a polygon or curve, a double click or Enter ends it, Backspace drops the last
// vertex, Esc drops them all); a double click on a polygon or curve adds a vertex; the Pencil turns a stroke into a smooth
// curve; Node turns a clicked point, or a new one, into a node and opens its label.
import { curveControls, flattenPath, type DrawingModel, type Vec } from "../../../drawing/index.js";
import { snapPosition } from "./snap.js";
import { itemKey, place, pointById, r2, same, styled, type Draft, type DraftVertex, type EditorState, type HitTarget, type IdSource, type Item, type Point } from "./state.js";

type Pointer = { x: number; y: number; shift: boolean; alt: boolean; target: HitTarget | null };

/** Least distance, in grid units, between two samples of a freehand stroke, how far the simplified stroke may stray from it, and how near its end must come back to its start for a closed curve. */
const FREEHAND_STEP = 0.1;
const FREEHAND_TOLERANCE = 0.15;
const FREEHAND_CLOSE = 0.5;


/** The state with `item` appended and selected. */
function added(state: EditorState, model: DrawingModel, item: Item): EditorState {
  return { ...state, draft: null, model: { ...model, items: [...model.items, item] }, selection: new Set([itemKey(model.items.length)]) };
}

// ---- vertex by vertex: Polygon, Curve, Angle ----

/** The vertices clicked so far, with repeats (the clicks of a double click) dropped. */
function vertices(draft: Draft | null): DraftVertex[] {
  return (draft?.path ?? []).filter((v, i, all) => i === 0 || !same(v.at, all[i - 1]!.at));
}

/** Ends the vertex gesture: makes the points not snapped to an existing one and the polygon, curve or angle mark; drops it when too short. */
export function finishPath(state: EditorState, ids: IdSource, closeIt: boolean): EditorState {
  const path = vertices(state.draft);
  const done = { ...state, draft: null };
  const kind = state.tool === "curve" ? "curve" : state.tool === "angle" ? "angle" : "poly";
  if (path.length < (kind === "angle" ? 3 : 2)) { return done; }
  let model = state.model;
  const pts = path.map((v) => {
    if (v.id !== undefined && pointById(model, v.id)) { return v.id; }
    const point: Point = { id: ids.take("p"), x: v.at.x, y: v.at.y, dot: false };
    model = { ...model, points: [...model.points, point] };
    return point.id;
  });
  if (kind === "angle") { return added(state, model, { k: "angle", a: pts[0]!, o: pts[1]!, b: pts[2]!, ...styled(state.style) }); }
  const closed = (kind === "poly" || closeIt) && pts.length > 2;
  return added(state, model, { k: kind, pts, closed, ...styled(state.style) } as Item);
}

/** A click with Polygon, Curve or Angle: adds the snapped vertex; a click on the first vertex closes the shape, the third vertex ends an angle. */
export function clickVertex(state: EditorState, event: Pointer, scale: number, ids: IdSource): EditorState {
  const path = vertices(state.draft);
  const last = path[path.length - 1];
  const onPoint = event.target?.kind === "point" ? pointById(state.model, event.target.id) : undefined;
  const snap = onPoint ? { x: onPoint.x, y: onPoint.y, pointId: onPoint.id } : snapPosition(state.model, { x: event.x, y: event.y, shift: event.shift, alt: event.alt, scale, ...(last ? { from: last.at } : {}) });
  const vertex: DraftVertex = { at: { x: r2(snap.x), y: r2(snap.y) }, ...(snap.pointId !== undefined ? { id: snap.pointId } : {}) };
  const first = path[0];
  if (state.tool !== "angle" && first && path.length >= 3 && same(first.at, vertex.at)) { return finishPath(state, ids, true); }
  const next = [...(state.draft?.path ?? []), vertex];
  const draft: Draft = { kind: "path", start: next[0]!.at, current: vertex.at, path: next };
  return state.tool === "angle" && vertices(draft).length === 3 ? finishPath({ ...state, draft }, ids, false) : { ...state, editingLabel: null, draft };
}

/** Backspace while clicking vertices: drops the last one (and the gesture with the first). */
export function dropVertex(state: EditorState): EditorState {
  const path = vertices(state.draft).slice(0, -1);
  const last = path[path.length - 1];
  return last ? { ...state, draft: { kind: "path", start: path[0]!.at, current: last.at, path } } : { ...state, draft: null };
}

/** Samples per piece when finding where a double click meets a polygon or curve. */
const PIECE_SAMPLES = 32;

/** A double click on a polygon or curve: a new vertex at the nearest place on it, between the two it falls between; the new point is selected. */
export function insertVertex(state: EditorState, index: number, at: Vec, ids: IdSource): EditorState {
  const item = state.model.items[index];
  if (item?.k !== "poly" && item?.k !== "curve") { return state; }
  const pts = item.pts.map((id) => pointById(state.model, id));
  if (!pts.every((p): p is Point => p !== undefined)) { return state; }
  const closed = item.closed && pts.length > 2;
  // A polygon side is a cubic with its control points on its ends, so one search serves both kinds.
  const pieces = item.k === "curve" ? curveControls(pts, closed, item.ctrl) : pts.slice(0, closed ? pts.length : -1).map((from, i) => { const to = pts[(i + 1) % pts.length]!; return { from, c1: from, c2: to, to }; });
  let best = { piece: -1, at: at, d: Infinity };
  pieces.forEach((p, i) => {
    for (const v of flattenPath({ start: p.from, segs: [{ k: "C", c1: p.c1, c2: p.c2, to: p.to }], closed: false }, PIECE_SAMPLES).slice(1, -1)) {
      const d = Math.hypot(v.x - at.x, v.y - at.y);
      if (d < best.d) { best = { piece: i, at: v, d }; }
    }
  });
  if (best.piece < 0) { return state; }
  const point: Point = { id: ids.take("p"), x: r2(best.at.x), y: r2(best.at.y), dot: false };
  const nextPts = [...item.pts.slice(0, best.piece + 1), point.id, ...item.pts.slice(best.piece + 1)];
  const next: Item = item.k === "curve" && item.ctrl ? { ...item, pts: nextPts, ctrl: [...item.ctrl.slice(0, best.piece), null, null, ...item.ctrl.slice(best.piece + 1)] } : { ...item, pts: nextPts };
  const model = { ...state.model, points: [...state.model.points, point], items: state.model.items.map((it, i) => (i === index ? next : it)) };
  return { ...state, draft: null, model, selection: new Set([point.id]) };
}

// ---- freehand: Pencil ----

/** A pointer move with the Pencil: the stroke takes the position when it moved far enough from the last sample. */
export function addFreehand(state: EditorState): EditorState {
  const d = state.draft;
  if (state.tool !== "freehand" || d?.kind !== "path" || !d.path) { return state; }
  const last = d.path[d.path.length - 1]!.at;
  return Math.hypot(d.current.x - last.x, d.current.y - last.y) < FREEHAND_STEP ? state : { ...state, draft: { ...d, path: [...d.path, { at: d.current }] } };
}

/** The samples kept by Ramer–Douglas–Peucker: none strays more than `tolerance` from the polyline through the kept ones. */
function simplify(pts: readonly Vec[], tolerance: number): Vec[] {
  if (pts.length < 3) { return [...pts]; }
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let far = 0;
  let index = 0;
  pts.forEach((p, i) => {
    const d = len === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d > far) { far = d; index = i; }
  });
  if (far <= tolerance) { return [a, b]; }
  return [...simplify(pts.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(pts.slice(index), tolerance)];
}

/** The end of a Pencil stroke: a smooth curve through the simplified stroke, closed when it ends near its start; a stroke too short to keep is dropped. */
export function finishFreehand(state: EditorState, ids: IdSource): EditorState {
  const raw = (state.draft?.path ?? []).map((v) => v.at);
  let pts = simplify(raw, FREEHAND_TOLERANCE).map((v) => ({ x: r2(v.x), y: r2(v.y) }));
  const done = { ...state, draft: null };
  if (pts.length < 2 || (pts.length === 2 && same(pts[0]!, pts[1]!))) { return done; }
  const closed = pts.length > 3 && Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y) < FREEHAND_CLOSE;
  if (closed) { pts = pts.slice(0, -1); }
  const points: Point[] = pts.map((at) => ({ id: ids.take("p"), x: at.x, y: at.y, dot: false }));
  return added(state, { ...state.model, points: [...state.model.points, ...points] }, { k: "curve", pts: points.map((p) => p.id), closed, ...styled(state.style) });
}

// ---- Node ----

/** A click with Node: the clicked point (or the point snapped to, or a new one) becomes a circle node, with its label open. */
export function placeNode(state: EditorState, event: Pointer, scale: number, ids: IdSource): EditorState {
  const placed = event.target?.kind === "point" ? { model: state.model, id: event.target.id } : place(state.model, ids, { x: event.x, y: event.y }, event, scale, false);
  const points = placed.model.points.map((p) => (p.id === placed.id && p.shape === undefined ? { ...p, shape: "circle" as const } : p));
  return { ...state, model: { ...placed.model, points }, selection: new Set([placed.id]), editingLabel: placed.id };
}
