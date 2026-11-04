// Gestures of the shape tools as pure transitions, in grid units (y up): Polygon, Curve and Angle click their vertices one
// by one (a click on the first vertex closes a polygon or curve, a double click or Enter ends it, Backspace drops the last
// vertex, Esc drops them all); Regular polygon, Ellipse and Arc drag from the centre outwards (digits 3 to 9 set a regular
// polygon's corners while dragging); Node turns a clicked point, or a new one, into a node and opens its label.
import { toDegrees as deg, turnDegrees as turn, type DrawingModel, type Vec } from "../../../drawing/index.js";
import { snapPosition } from "./snap.js";
import { itemKey, place, pointById, r2, same, startPoint, styled, type Draft, type DraftVertex, type EditorState, type HitTarget, type IdSource, type Item, type Point } from "./state.js";

type Pointer = { x: number; y: number; shift: boolean; alt: boolean; target: HitTarget | null };

/** Corners of a new regular polygon, and the sweep, in degrees, of a new arc. */
const DEFAULT_SIDES = 6;
const ARC_SWEEP = 90;


/** The state with `item` appended and selected. */
function added(state: EditorState, model: DrawingModel, item: Item): EditorState {
  return { ...state, draft: null, model: { ...model, items: [...model.items, item] }, selection: new Set([itemKey(model.items.length)]) };
}

// ---- drags from the centre: Regular polygon, Ellipse, Arc ----

/** Starts a Regular polygon, Ellipse or Arc drag on the pressed point, or at the snapped position. */
export function startShapeDrag(state: EditorState, kind: 'ngon' | 'ellipse' | 'arc', event: Pointer, scale: number): EditorState {
  const pressed = event.target?.kind === "point" ? pointById(state.model, event.target.id) : undefined;
  const snap = pressed ? { x: pressed.x, y: pressed.y, pointId: pressed.id } : snapPosition(state.model, { x: event.x, y: event.y, shift: false, alt: event.alt, scale });
  const start = { x: r2(snap.x), y: r2(snap.y) };
  const draft: Draft = { kind, start, current: start, ...(snap.pointId !== undefined ? { from: snap.pointId } : {}), ...(kind === "ngon" ? { sides: DEFAULT_SIDES } : {}) };
  return { ...state, editingLabel: null, draft };
}

/** The end of a centre drag: snapped to the grid or a point (raw with Alt); with Shift an ellipse keeps equal radii. */
function dragEnd(state: EditorState, draft: Draft, event: Pointer, scale: number): Vec {
  const ignore = new Set(draft.from !== undefined ? [draft.from] : []);
  const snap = snapPosition(state.model, { x: event.x, y: event.y, shift: false, alt: event.alt, scale }, ignore);
  return { x: r2(snap.x), y: r2(snap.y) };
}

/** The item a centre drag from `c` to `end` makes, or null when it has no size. */
export function dragShape(draft: Draft, c: string, end: Vec, shift: boolean): Item | null {
  const dx = end.x - draft.start.x;
  const dy = end.y - draft.start.y;
  const r = r2(Math.hypot(dx, dy));
  const angle = Math.round(turn(deg(Math.atan2(dy, dx))));
  switch (draft.kind) {
    case "ngon": return r > 0 ? { k: "ngon", c, r, n: draft.sides ?? DEFAULT_SIDES, rot: angle } : null;
    case "arc": return r > 0 ? { k: "arc", c, r, from: angle, to: angle + ARC_SWEEP } : null;
    case "ellipse": {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      const [rx, ry] = shift ? [side, side] : [Math.abs(dx), Math.abs(dy)];
      return rx > 0 && ry > 0 ? { k: "ellipse", c, rx: r2(rx), ry: r2(ry) } : null;
    }
    default: return null;
  }
}

export function finishShapeDrag(state: EditorState, draft: Draft, event: Pointer, scale: number, ids: IdSource): EditorState {
  const shape = dragShape(draft, "", dragEnd(state, draft, event, scale), event.shift);
  if (!shape || !("c" in shape)) { return { ...state, draft: null }; }
  const begun = startPoint(state.model, ids, draft, false);
  return added(state, begun.model, { ...shape, c: begun.id, ...styled(state.style) } as Item);
}

/** A digit 3 to 9 while a regular polygon is dragged sets its corners. */
export function setSides(state: EditorState, key: string): EditorState {
  const sides = Number(key);
  return state.draft?.kind === "ngon" && Number.isInteger(sides) && sides >= 3 && sides <= 9 ? { ...state, draft: { ...state.draft, sides } } : state;
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

// ---- Node ----

/** A click with Node: the clicked point (or the point snapped to, or a new one) becomes a circle node, with its label open. */
export function placeNode(state: EditorState, event: Pointer, scale: number, ids: IdSource): EditorState {
  const placed = event.target?.kind === "point" ? { model: state.model, id: event.target.id } : place(state.model, ids, { x: event.x, y: event.y }, event, scale, false);
  const points = placed.model.points.map((p) => (p.id === placed.id && p.shape === undefined ? { ...p, shape: "circle" as const } : p));
  return { ...state, model: { ...placed.model, points }, selection: new Set([placed.id]), editingLabel: placed.id };
}
