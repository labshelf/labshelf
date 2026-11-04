// Handles of the single selected item and what dragging one does, as pure functions in grid units (y up): a segment's bend,
// a curve's control points, the radius of a circle, a regular polygon (and its turn), an ellipse's radii (and its turn), an
// arc's two ends, an angle mark's radius. While a handle is dragged the canvas shows the model as the drag would leave it.
import { curveControls, toDegrees, turnDegrees as turn, type DrawingModel, type Vec } from "../../../drawing/index.js";
import { itemIndexOf, r2, type EditorState, type Item } from "./state.js";

/** A handle at `at`; `base` is the point a guide line joins it to (a control point's end, a radius's centre). */
export interface Handle { id: string; at: Vec; base?: Vec }

const DEG = Math.PI / 180;
/** The steepest bend a segment handle sets, in degrees. */
const MAX_BEND = 85;

const polar = (c: Vec, r: number, angleDeg: number): Vec => ({ x: c.x + r * Math.cos(angleDeg * DEG), y: c.y + r * Math.sin(angleDeg * DEG) });
const angleOf = (c: Vec, at: Vec): number => toDegrees(Math.atan2(at.y - c.y, at.x - c.x));
const dist = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);
/** A positive radius rounded as the model stores it. */
const radius = (value: number): number => Math.max(0.01, r2(value));

function pointAt(model: DrawingModel, id: string): Vec | undefined {
  return model.points.find((p) => p.id === id);
}

/** The middle of a segment's drawn line: on its bend's quadratic, half the control offset off the chord. */
function bendHandle(a: Vec, b: Vec, bend: number): Vec {
  const len = dist(a, b);
  const off = (len / 4) * Math.tan(bend * DEG);
  const u = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 0, y: 0 };
  return { x: (a.x + b.x) / 2 - u.y * off, y: (a.y + b.y) / 2 + u.x * off };
}

/** The handles of the item at `index`; none for kinds edited only through their points or the inspector. */
export function itemHandles(model: DrawingModel, index: number): Handle[] {
  const item = model.items[index];
  const at = (id: string): Vec | undefined => pointAt(model, id);
  switch (item?.k) {
    case "seg": {
      const [a, b] = [at(item.a), at(item.b)];
      return a && b ? [{ id: "bend", at: bendHandle(a, b, item.bend ?? 0) }] : [];
    }
    case "curve": {
      const pts = item.pts.map(at);
      if (!pts.every((p): p is Vec => p !== undefined)) { return []; }
      return curveControls(pts, item.closed && pts.length > 2, item.ctrl).flatMap((piece, i): Handle[] => [{ id: `c${i}a`, at: piece.c1, base: piece.from }, { id: `c${i}b`, at: piece.c2, base: piece.to }]);
    }
    case "circle": {
      const c = at(item.c);
      return c ? [{ id: "r", at: { x: c.x + item.r, y: c.y }, base: c }] : [];
    }
    case "ngon": {
      const c = at(item.c);
      return c ? [{ id: "r", at: polar(c, item.r, item.rot), base: c }] : [];
    }
    case "ellipse": {
      const c = at(item.c);
      const rot = item.rot ?? 0;
      return c ? [{ id: "rx", at: polar(c, item.rx, rot), base: c }, { id: "ry", at: polar(c, item.ry, rot + 90), base: c }] : [];
    }
    case "arc": {
      const c = at(item.c);
      return c ? [{ id: "from", at: polar(c, item.r, item.from), base: c }, { id: "to", at: polar(c, item.r, item.to) }] : [];
    }
    case "angle": {
      const [a, o, b] = [at(item.a), at(item.o), at(item.b)];
      if (!a || !o || !b) { return []; }
      const u = { x: (a.x - o.x) / (dist(o, a) || 1) + (b.x - o.x) / (dist(o, b) || 1), y: (a.y - o.y) / (dist(o, a) || 1) + (b.y - o.y) / (dist(o, b) || 1) };
      const len = Math.hypot(u.x, u.y) || 1;
      const r = item.r ?? 0.8;
      return [{ id: "r", at: { x: o.x + (u.x / len) * r, y: o.y + (u.y / len) * r }, base: o }];
    }
    default:
      return [];
  }
}

/** A curve with the control point `handle` (c<piece>a or c<piece>b) at `to`; the other pieces keep theirs. */
function dragControl(model: DrawingModel, item: Extract<Item, { k: 'curve' }>, handle: string, to: Vec): Item {
  const match = /^c(\d+)([ab])$/.exec(handle);
  const pts = item.pts.map((id) => pointAt(model, id));
  if (!match || !pts.every((p): p is Vec => p !== undefined)) { return item; }
  const piece = Number(match[1]);
  const pieces = curveControls(pts, item.closed && pts.length > 2, item.ctrl);
  const current = pieces[piece];
  if (!current) { return item; }
  const ctrl = pieces.map((p, i) => item.ctrl?.[i] ?? (i === piece ? [p.c1.x - p.from.x, p.c1.y - p.from.y, p.c2.x - p.to.x, p.c2.y - p.to.y] as [number, number, number, number] : null));
  const [ax, ay, bx, by] = ctrl[piece]!;
  ctrl[piece] = match[2] === "a" ? [r2(to.x - current.from.x), r2(to.y - current.from.y), bx, by] : [ax, ay, r2(to.x - current.to.x), r2(to.y - current.to.y)];
  return { ...item, ctrl };
}

/** The item at `index` with its handle `handle` dragged to `to`. */
function draggedItem(model: DrawingModel, item: Item, handle: string, to: Vec): Item {
  const at = (id: string): Vec | undefined => pointAt(model, id);
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
    case "curve": return dragControl(model, item, handle, to);
    case "circle": { const c = at(item.c); return c ? { ...item, r: radius(dist(c, to)) } : item; }
    case "ngon": { const c = at(item.c); return c ? { ...item, r: radius(dist(c, to)), rot: r2(turn(angleOf(c, to))) } : item; }
    case "ellipse": {
      const c = at(item.c);
      if (!c) { return item; }
      if (handle === "ry") { return { ...item, ry: radius(dist(c, to)) }; }
      const rot = Math.round(turn(angleOf(c, to)));
      const { rot: _old, ...rest } = item;
      return { ...rest, rx: radius(dist(c, to)), ...(rot === 0 ? {} : { rot }) };
    }
    case "arc": {
      const c = at(item.c);
      if (!c) { return item; }
      const a = Math.round(angleOf(c, to));
      if (handle === "from") {
        const from = turn(a);
        const sweep = turn(item.to - from) || 360;
        return { ...item, r: radius(dist(c, to)), from, to: from + sweep };
      }
      return { ...item, to: item.from + (turn(a - item.from) || 360) };
    }
    case "angle": { const o = at(item.o); return o ? { ...item, r: radius(dist(o, to)) } : item; }
    default: return item;
  }
}

/** The model with the handle `handle` of the item at `index` dragged to `to`. */
export function dragHandle(model: DrawingModel, index: number, handle: string, to: Vec): DrawingModel {
  const item = model.items[index];
  if (!item) { return model; }
  const next = draggedItem(model, item, handle, to);
  return next === item ? model : { ...model, items: model.items.map((it, i) => (i === index ? next : it)) };
}

/** The model as the canvas shows it: with the handle drag in progress applied. */
export function shownModel(state: EditorState): DrawingModel {
  const d = state.draft;
  return d?.kind === "handle" && d.index !== undefined && d.handle !== undefined ? dragHandle(state.model, d.index, d.handle, d.current) : state.model;
}

/** The index of the single selected item, the one whose handles show. */
export function handleItem(state: EditorState): number | null {
  if (state.selection.size !== 1) { return null; }
  return itemIndexOf([...state.selection][0]!);
}
