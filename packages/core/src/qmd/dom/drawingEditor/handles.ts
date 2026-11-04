// Handles of the selection and what dragging one does, as pure functions in grid units (y up): the single selected item's
// own (a segment's bend, a curve's control points, an arc's two ends, an angle mark's radius) and the transform box of
// transform.ts. A curve's two control points at one anchor stay in line (a smooth anchor) unless Alt is held.
import { applyMat, curveControls, invertMat, toDegrees, transformMatrix, turnDegrees as turn, type Ctrl, type DrawingModel, type Mat2, type Vec } from "../../../drawing/index.js";
import { itemIndexOf, pointById, r2, type Draft, type EditorState, type IdSource, type Item } from "./state.js";
import { applyAffine, frameAffine, frameHandles, selectionFrame, type Handle } from "./transform.js";

const DEG = Math.PI / 180;
/** The steepest bend a segment handle sets, in degrees. */
const MAX_BEND = 85;
/** The radius an angle mark has when it sets none (drawingShapes.ts). */
const ANGLE_R = 0.8;

const polar = (r: number, angleDeg: number): Vec => ({ x: r * Math.cos(angleDeg * DEG), y: r * Math.sin(angleDeg * DEG) });
const dist = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);
/** A positive radius rounded as the model stores it. */
const radius = (value: number): number => Math.max(0.01, r2(value));
const offset = (a: Vec, b: Vec): Vec => ({ x: b.x - a.x, y: b.y - a.y });

/** The local point v of a shape centred at c, through its transform m. */
const through = (c: Vec, m: Mat2, v: Vec): Vec => { const w = applyMat(m, v); return { x: c.x + w.x, y: c.y + w.y }; };

/** The middle of a segment's drawn line: on its bend's quadratic, half the control offset off the chord. */
function bendHandle(a: Vec, b: Vec, bend: number): Vec {
  const len = dist(a, b);
  const off = (len / 4) * Math.tan(bend * DEG);
  const u = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 0, y: 0 };
  return { x: (a.x + b.x) / 2 - u.y * off, y: (a.y + b.y) / 2 + u.x * off };
}

/** The handles of the item at `index`; none for kinds edited through their points, the transform box or the inspector. */
export function itemHandles(model: DrawingModel, index: number): Handle[] {
  const item = model.items[index];
  const at = (id: string): Vec | undefined => pointById(model, id);
  switch (item?.k) {
    case "seg": {
      const [a, b] = [at(item.a), at(item.b)];
      return a && b ? [{ id: "bend", at: bendHandle(a, b, item.bend ?? 0), kind: "point" }] : [];
    }
    case "curve": {
      const pts = item.pts.map(at);
      if (!pts.every((p): p is Vec => p !== undefined)) { return []; }
      return curveControls(pts, item.closed && pts.length > 2, item.ctrl).flatMap((piece, i): Handle[] => [{ id: `c${i}a`, at: piece.c1, base: piece.from, kind: "point" }, { id: `c${i}b`, at: piece.c2, base: piece.to, kind: "point" }]);
    }
    case "arc": {
      const c = at(item.c);
      const m = transformMatrix(item.tf);
      return c ? [{ id: "from", at: through(c, m, polar(item.r, item.from)), base: c, kind: "point" }, { id: "to", at: through(c, m, polar(item.r, item.to)), kind: "point" }] : [];
    }
    case "angle": {
      const [a, o, b] = [at(item.a), at(item.o), at(item.b)];
      if (!a || !o || !b) { return []; }
      const u = { x: (a.x - o.x) / (dist(o, a) || 1) + (b.x - o.x) / (dist(o, b) || 1), y: (a.y - o.y) / (dist(o, a) || 1) + (b.y - o.y) / (dist(o, b) || 1) };
      const len = Math.hypot(u.x, u.y) || 1;
      const r = item.r ?? ANGLE_R;
      return [{ id: "r", at: { x: o.x + (u.x / len) * r, y: o.y + (u.y / len) * r }, base: o, kind: "point" }];
    }
    default:
      return [];
  }
}

/** `v` turned to point against `dir`, keeping its own length (the other control point of a smooth anchor). */
function opposite(dir: Vec, v: Vec): Vec {
  const len = Math.hypot(dir.x, dir.y);
  const keep = Math.hypot(v.x, v.y);
  return len > 0 ? { x: r2((-dir.x / len) * keep), y: r2((-dir.y / len) * keep) } : v;
}

/** A curve with the control point `handle` (c<piece>a leaves the piece's start, c<piece>b enters its end) at `to`; without Alt the other control point at that anchor turns to stay in line. */
function dragControl(model: DrawingModel, item: Extract<Item, { k: 'curve' }>, handle: string, to: Vec, alt: boolean): Item {
  const match = /^c(\d+)([ab])$/.exec(handle);
  const pts = item.pts.map((id) => pointById(model, id));
  if (!match || !pts.every((p): p is NonNullable<typeof p> => p !== undefined)) { return item; }
  const closed = item.closed && pts.length > 2;
  const pieces = curveControls(pts, closed, item.ctrl);
  const piece = Number(match[1]);
  if (!pieces[piece]) { return item; }
  const ctrl: Array<Ctrl | null> = pieces.map((_p, i) => item.ctrl?.[i] ?? null);
  const own = (i: number): Ctrl => { const p = pieces[i]!; return ctrl[i] ?? [p.c1.x - p.from.x, p.c1.y - p.from.y, p.c2.x - p.to.x, p.c2.y - p.to.y]; };
  const wrap = (i: number): number | null => (i >= 0 && i < pieces.length ? i : closed ? (i + pieces.length) % pieces.length : null);
  const outgoing = match[2] === "a";
  const anchor = outgoing ? pieces[piece]!.from : pieces[piece]!.to;
  const dir = offset(anchor, to);
  const mine = own(piece);
  ctrl[piece] = outgoing ? [r2(dir.x), r2(dir.y), mine[2], mine[3]] : [mine[0], mine[1], r2(dir.x), r2(dir.y)];
  const next = alt ? null : wrap(outgoing ? piece - 1 : piece + 1);
  if (next !== null && next !== piece) {
    const theirs = own(next);
    if (outgoing) { const v = opposite(dir, { x: theirs[2], y: theirs[3] }); ctrl[next] = [theirs[0], theirs[1], v.x, v.y]; } else { const v = opposite(dir, { x: theirs[0], y: theirs[1] }); ctrl[next] = [v.x, v.y, theirs[2], theirs[3]]; }
  }
  return { ...item, ctrl };
}

/** The item with its handle `handle` dragged to `to`. */
function draggedItem(model: DrawingModel, item: Item, handle: string, to: Vec, alt: boolean): Item {
  const at = (id: string): Vec | undefined => pointById(model, id);
  switch (item.k) {
    case "seg": {
      const [a, b] = [at(item.a), at(item.b)];
      const len = a && b ? dist(a, b) : 0;
      if (!a || !b || len === 0) { return item; }
      // The handle's signed distance left of the chord's middle is (len / 4) * tan(bend).
      const off = (-(b.y - a.y) * (to.x - (a.x + b.x) / 2) + (b.x - a.x) * (to.y - (a.y + b.y) / 2)) / len;
      const bend = Math.max(-MAX_BEND, Math.min(MAX_BEND, Math.round(toDegrees(Math.atan((4 * off) / len)))));
      const { bend: _old, ...rest } = item;
      return bend === 0 ? rest : { ...rest, bend };
    }
    case "curve": return dragControl(model, item, handle, to, alt);
    case "arc": {
      const c = at(item.c);
      const inv = invertMat(transformMatrix(item.tf));
      if (!c || !inv) { return item; }
      // The pointer in the arc's own frame (before its transform) gives the angle and, for the start, the radius.
      const local = applyMat(inv, offset(c, to));
      const a = Math.round(toDegrees(Math.atan2(local.y, local.x)));
      if (handle === "from") {
        const from = turn(a);
        return { ...item, r: radius(Math.hypot(local.x, local.y)), from, to: from + (turn(item.to - from) || 360) };
      }
      return { ...item, to: item.from + (turn(a - item.from) || 360) };
    }
    case "angle": { const o = at(item.o); return o ? { ...item, r: radius(dist(o, to)) } : item; }
    default: return item;
  }
}

/** The model with the handle `handle` of the item at `index` dragged to `to`. */
export function dragHandle(model: DrawingModel, index: number, handle: string, to: Vec, alt = false): DrawingModel {
  const item = model.items[index];
  if (!item) { return model; }
  const next = draggedItem(model, item, handle, to, alt);
  return next === item ? model : { ...model, items: model.items.map((it, i) => (i === index ? next : it)) };
}

/** The index of the single selected item, the one whose own handles show. */
export function handleItem(state: EditorState): number | null {
  if (state.selection.size !== 1) { return null; }
  return itemIndexOf([...state.selection][0]!);
}

/** The handles the Select tool shows: the single selected item's own, then the transform box's. */
export function selectionHandles(state: EditorState): Handle[] {
  if (state.tool !== "select") { return []; }
  const index = handleItem(state);
  const frame = selectionFrame(state);
  return [...(index === null ? [] : itemHandles(state.model, index)), ...(frame ? frameHandles(frame) : [])];
}

/** The model after dragging the draft's handle to its current position: a transform box handle maps the selection, an item handle reshapes its item. */
export function dragSelection(state: EditorState, draft: Draft, ids: IdSource): DrawingModel {
  if (draft.handle?.startsWith("t:")) {
    const frame = selectionFrame(state);
    const aff = frame && frameAffine(frame, draft.handle, draft.current, draft.shift ?? false);
    return aff ? applyAffine(state, aff, ids) : state.model;
  }
  return dragHandle(state.model, draft.index ?? -1, draft.handle ?? "", { x: r2(draft.current.x), y: r2(draft.current.y) }, draft.alt ?? false);
}
