// The drawing editor's state (decisions D6, D7, D9): the model being edited, the active tool, the selection (point ids and `i<index>` items), the open label or expression field, the gesture in progress and the style new items get.
import { mapRefs, parseExpr, pointRefs as refsOf, type DrawingModel, type DrawingStyle, type Vec } from "../../../drawing/index.js";
import { snapPosition } from "./snap.js";

export type Tool = 'select' | 'point' | 'line' | 'arrow' | 'polygon' | 'curve' | 'freehand' | 'angle' | 'node' | 'label';

/** A handle of the single selected item (handles.ts): a curve's control point, a radius, an arc end, a segment's bend. */
export type HitTarget = { kind: 'point'; id: string } | { kind: 'item'; index: number } | { kind: 'axes'; id: string; index: number } | { kind: 'handle'; index: number; handle: string }

/** A vertex of a polygon, curve or angle being clicked out: its position and the existing point it snapped to. */
export interface DraftVertex { at: Vec; id?: string }

/** The gesture in progress: a drag from `start` to `current` with the modifiers last seen; `path` holds the vertices
 * clicked so far (Polygon, Curve, Angle) or the samples of a Pencil stroke, `handle` and `index` the handle being dragged. */
export interface Draft { kind: 'move' | 'join' | 'marquee' | 'path' | 'handle'; start: Vec; current: Vec; shift?: boolean; alt?: boolean; from?: string; ids?: string[]; path?: DraftVertex[]; index?: number; handle?: string }

export interface EditorState { model: DrawingModel; tool: Tool; selection: ReadonlySet<string>; editingLabel: string | null; draft: Draft | null; style: DrawingStyle }

/** The selection key of the item at `index` in model.items. */
export function itemKey(index: number): string {
  return `i${index}`;
}

/** The item index a selection or label key names, or null when the key is a point id. */
export function itemIndexOf(key: string): number | null {
  const match = /^i(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

/** A fresh editor on the model: Select tool, nothing selected, no field open, no gesture, default style. */
export function createEditorState(model: DrawingModel): EditorState {
  return { model, tool: "select", selection: new Set<string>(), editingLabel: null, draft: null, style: {} };
}

// ---- model operations shared by the gestures ----

export type Point = DrawingModel["points"][number];
export type Item = DrawingModel["items"][number];
export type Axes = Extract<Item, { k: 'axes' }>;

/** Offset of the copies ⌘D makes. */
const DUPLICATE_OFFSET: Vec = { x: 1, y: -1 };

/** A coordinate rounded to 0.01, never -0, as the model stores it. */
export function r2(value: number): number {
  const out = Math.round(value * 100) / 100;
  return out === 0 ? 0 : out;
}

export function same(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

// ---- ids ----

/** The next free numeric suffix per prefix, carried from state to state so ids are never reused within a drawing. */
const counters = new WeakMap<EditorState, Record<IdPrefix, number>>();

/** Id prefixes: p for points, a for axes, g for groups. */
type IdPrefix = 'p' | 'a' | 'g';

/** Hands out short ids (p1, p2, …; a1, … for axes; g1, … for groups) not used in the model and not handed out before. */
export class IdSource {
  private readonly taken: Set<string>;
  private readonly next: Record<IdPrefix, number>;

  constructor(state: EditorState) {
    const model = state.model;
    this.taken = new Set([...model.points.map((p) => p.id), ...model.items.flatMap((item) => [...(item.k === "axes" ? [item.id] : []), ...(item.g ? [item.g] : [])])]);
    const seen = counters.get(state);
    const start = (prefix: IdPrefix): number => Math.max(seen?.[prefix] ?? 1, this.maxSuffix(prefix) + 1);
    this.next = { p: start("p"), a: start("a"), g: start("g") };
  }

  private maxSuffix(prefix: IdPrefix): number {
    let max = 0;
    for (const id of this.taken) {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
      if (match) { max = Math.max(max, Number(match[1])); }
    }
    return max;
  }

  take(prefix: IdPrefix): string {
    let id = `${prefix}${this.next[prefix]++}`;
    while (this.taken.has(id)) { id = `${prefix}${this.next[prefix]++}`; }
    this.taken.add(id);
    return id;
  }

  remember(state: EditorState): void {
    counters.set(state, { ...this.next });
  }
}

// ---- model helpers ----

export function axesById(model: DrawingModel, id: string): Axes | undefined {
  const found = model.items.find((item) => item.k === "axes" && item.id === id);
  return found?.k === "axes" ? found : undefined;
}

/** The axes and x range of the fn item at `index`, or undefined when it is not a plottable function. */
export function curveOf(model: DrawingModel, index: number): { axes: Axes; origin: Point; range: [number, number]; expr: string } | undefined {
  const item = model.items[index];
  if (item?.k !== "fn") { return undefined; }
  const axes = axesById(model, item.axes);
  const origin = axes && model.points.find((p) => p.id === axes.o);
  if (!axes || !origin) { return undefined; }
  return { axes, origin, range: item.domain ?? axes.x, expr: item.expr };
}

export function clamp(value: number, [lo, hi]: [number, number]): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Puts every point stored on a curve back on it: x and y follow its axes origin and the function at `on.x`. */
export function reflow(model: DrawingModel): DrawingModel {
  if (!model.points.some((p) => p.on)) { return model; }
  const points = model.points.map((point) => {
    if (!point.on) { return point; }
    const curve = curveOf(model, point.on.item);
    if (!curve) { return point; }
    const parsed = parseExpr(curve.expr);
    if (!parsed.ok) { return point; }
    const y = parsed.evaluate(point.on.x);
    if (!Number.isFinite(y)) { return point; }
    return { ...point, x: r2(curve.origin.x + point.on.x * curve.axes.sx), y: r2(curve.origin.y + y * curve.axes.sy) };
  });
  return { ...model, points };
}

function withoutOn(point: Point): Point {
  const { on: _on, ...rest } = point;
  return rest;
}

/** A polygon or curve without the removed vertices, open when fewer than three are left (a curve smooth again); null when fewer than two are left. */
function withoutVertices(item: Item, pointIds: ReadonlySet<string>): Item | null {
  if ((item.k !== "poly" && item.k !== "curve") || !item.pts.some((id) => pointIds.has(id))) { return item; }
  const pts = item.pts.filter((id) => !pointIds.has(id));
  if (pts.length < 2) { return null; }
  const closed = item.closed && pts.length > 2;
  if (item.k === "poly") { return { ...item, pts, closed }; }
  const { ctrl: _ctrl, ...rest } = item;
  return { ...rest, pts, closed };
}

/** Removes the points and items named, the items that name a removed point (a polygon or curve only loses the vertex while two are left), and the functions of removed axes; renumbers `on` and drops it when its function went. */
export function removeFromModel(source: DrawingModel, pointIds: ReadonlySet<string>, itemIndexes: ReadonlySet<number>): DrawingModel {
  const model = { ...source, items: source.items.map((item, index) => (itemIndexes.has(index) ? item : withoutVertices(item, pointIds) ?? item)) };
  const gone = new Set<number>();
  const goneAxes = new Set<string>();
  model.items.forEach((item, index) => {
    if (itemIndexes.has(index) || refsOf(item).some((ref) => pointIds.has(ref))) {
      gone.add(index);
      if (item.k === "axes") { goneAxes.add(item.id); }
    }
  });
  model.items.forEach((item, index) => {
    if (item.k === "fn" && goneAxes.has(item.axes)) { gone.add(index); }
  });
  const renumber = new Map<number, number>();
  const items: Item[] = [];
  model.items.forEach((item, index) => {
    if (!gone.has(index)) { renumber.set(index, items.length); items.push(item); }
  });
  const points = model.points.filter((p) => !pointIds.has(p.id)).map((point) => {
    if (!point.on) { return point; }
    const to = renumber.get(point.on.item);
    return to === undefined ? withoutOn(point) : { ...point, on: { item: to, x: point.on.x } };
  });
  return { ...model, points, items };
}

/** Moves the named points and text items by (dx, dy); a point on a curve slides along it unless its axes move too. */
export function translate(model: DrawingModel, ids: ReadonlySet<string>, textIndexes: ReadonlySet<number>, dx: number, dy: number): DrawingModel {
  if (dx === 0 && dy === 0) { return model; }
  const points = model.points.map((point) => {
    if (!ids.has(point.id)) { return point; }
    const curve = point.on && curveOf(model, point.on.item);
    if (point.on && curve) {
      if (ids.has(curve.origin.id)) { return point; }
      return { ...point, on: { item: point.on.item, x: r2(clamp(point.on.x + dx / curve.axes.sx, curve.range)) } };
    }
    return { ...point, x: r2(point.x + dx), y: r2(point.y + dy) };
  });
  const items = model.items.map((item, index) => item.k === "text" && textIndexes.has(index) ? { ...item, x: r2(item.x + dx), y: r2(item.y + dy) } : item);
  return reflow({ ...model, points, items });
}

export function styled(style: DrawingStyle): { style?: DrawingStyle } {
  return Object.keys(style).length > 0 ? { style: { ...style } } : {};
}

// ---- placing points ----

export interface Mods { shift: boolean; alt: boolean }

/** The id of the point at the snapped position: an existing point it snaps to, or a new one (on a curve when it snaps to one). */
export function place(model: DrawingModel, ids: IdSource, at: Vec, mods: Mods, scale: number, dot: boolean, from?: Vec): { model: DrawingModel; id: string; created: boolean } {
  const snap = snapPosition(model, { x: at.x, y: at.y, shift: mods.shift, alt: mods.alt, scale, ...(from ? { from } : {}) });
  if (snap.pointId !== undefined) { return { model, id: snap.pointId, created: false }; }
  const point: Point = { id: ids.take("p"), x: r2(snap.x), y: r2(snap.y), dot, ...(snap.curve ? { on: { item: snap.curve.item, x: r2(snap.curve.x) } } : {}) };
  return { model: reflow({ ...model, points: [...model.points, point] }), id: point.id, created: true };
}

export function pointById(model: DrawingModel, id: string | undefined): Point | undefined {
  return id === undefined ? undefined : model.points.find((p) => p.id === id);
}

/** A grid-snapped position (raw with Alt). */
export function gridSnap(at: Vec, alt: boolean): Vec {
  return alt ? { x: r2(at.x), y: r2(at.y) } : { x: Math.round(at.x), y: Math.round(at.y) };
}

/** The draft's start point: the point it began on, or a new one at its start. */
export function startPoint(model: DrawingModel, ids: IdSource, draft: Draft, dot: boolean): { model: DrawingModel; id: string } {
  const existing = pointById(model, draft.from);
  if (existing) { return { model, id: existing.id }; }
  const point: Point = { id: ids.take("p"), x: draft.start.x, y: draft.start.y, dot };
  return { model: { ...model, points: [...model.points, point] }, id: point.id };
}

// ---- selection ----

export function selectedItemIndexes(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const key of state.selection) {
    const index = itemIndexOf(key);
    if (index !== null && state.model.items[index]) { out.add(index); }
  }
  return out;
}

/** The selected point ids plus the points the selected items name. */
export function selectedPointIds(state: EditorState): Set<string> {
  const known = new Set(state.model.points.map((p) => p.id));
  const out = new Set([...state.selection].filter((key) => known.has(key)));
  for (const index of selectedItemIndexes(state)) {
    const item = state.model.items[index];
    if (item) { refsOf(item).forEach((ref) => out.add(ref)); }
  }
  return out;
}

export function targetKey(target: HitTarget): string {
  return target.kind === "point" ? target.id : itemKey(target.index);
}

/** The points a drag starting on the target moves: the whole selection when the target is in it. */
export function draggedIds(state: EditorState, target: HitTarget, selection: ReadonlySet<string>): string[] {
  const view = { ...state, selection };
  if (selection.has(targetKey(target))) { return [...selectedPointIds(view)]; }
  if (target.kind === "point") { return [target.id]; }
  const item = state.model.items[target.index];
  return item ? refsOf(item) : [];
}


export function deleteSelection(state: EditorState): EditorState {
  if (state.selection.size === 0) { return state; }
  const known = new Set(state.model.points.map((p) => p.id));
  const pointIds = new Set([...state.selection].filter((key) => known.has(key)));
  return { ...state, model: reflow(removeFromModel(state.model, pointIds, selectedItemIndexes(state))), selection: new Set<string>() };
}

/** What a duplicate copies so far: new point ids per copied point, new axes ids, and the index each copied item gets. */
interface Copy { readonly model: DrawingModel; readonly pointMap: ReadonlyMap<string, string>; readonly selectedItems: ReadonlySet<number>; readonly axesMap: Map<string, string>; readonly itemMap: Map<number, number>; readonly copies: Item[] }

function addCopy(copy: Copy, index: number, item: Item): void {
  copy.itemMap.set(index, copy.model.items.length + copy.copies.length);
  copy.copies.push(item);
}

/** Copies a non-function item whose points are all copied (axes: whose origin is), or selected text. */
function copyShape(copy: Copy, item: Item, index: number, ids: IdSource): void {
  const mapped = (id: string): string => copy.pointMap.get(id) ?? id;
  switch (item.k) {
    case "axes":
      if (copy.pointMap.has(item.o)) {
        const id = ids.take("a");
        copy.axesMap.set(item.id, id);
        addCopy(copy, index, { ...item, id, o: mapped(item.o) });
      }
      break;
    case "text":
      if (copy.selectedItems.has(index)) { addCopy(copy, index, { ...item, x: r2(item.x + DUPLICATE_OFFSET.x), y: r2(item.y + DUPLICATE_OFFSET.y) }); }
      break;
    case "fn":
      break;
    default:
      if (refsOf(item).every((ref) => copy.pointMap.has(ref))) { addCopy(copy, index, mapRefs(item, mapped)); }
  }
}

/** Functions after the shapes: those of copied axes follow their axes, selected ones keep theirs. */
function copyFunctions(copy: Copy): void {
  copy.model.items.forEach((item, index) => {
    if (item.k !== "fn") { return; }
    const axes = copy.axesMap.get(item.axes);
    if (axes !== undefined) { addCopy(copy, index, { ...item, axes }); } else if (copy.selectedItems.has(index)) { addCopy(copy, index, { ...item }); }
  });
}

/** The copied points, offset by one unit; a point on a copied item stays on the copy. */
function copyPoints(copy: Copy): Point[] {
  const newPoints: Point[] = [];
  for (const point of copy.model.points) {
    const id = copy.pointMap.get(point.id);
    if (id === undefined) { continue; }
    const moved: Point = { ...withoutOn(point), id, x: r2(point.x + DUPLICATE_OFFSET.x), y: r2(point.y + DUPLICATE_OFFSET.y) };
    const onItem = point.on ? copy.itemMap.get(point.on.item) : undefined;
    newPoints.push(point.on && onItem !== undefined ? { ...moved, on: { item: onItem, x: point.on.x } } : moved);
  }
  return newPoints;
}

/** ⌘D: copies the selected points (offset by one unit), the items whose points are all copied, selected functions and text, and the functions of copied axes; the copies become the selection. */
export function duplicateSelection(state: EditorState, ids: IdSource): EditorState {
  if (state.selection.size === 0) { return state; }
  const model = state.model;
  const pts = selectedPointIds(state);
  const pointMap = new Map<string, string>();
  for (const point of model.points) {
    if (pts.has(point.id)) { pointMap.set(point.id, ids.take("p")); }
  }
  const copy: Copy = { model, pointMap, selectedItems: selectedItemIndexes(state), axesMap: new Map(), itemMap: new Map(), copies: [] };
  model.items.forEach((item, index) => copyShape(copy, item, index, ids));
  copyFunctions(copy);
  const newPoints = copyPoints(copy);
  const selection = new Set([...newPoints.map((p) => p.id), ...[...copy.itemMap.values()].map(itemKey)]);
  return { ...state, model: reflow({ ...model, points: [...model.points, ...newPoints], items: [...model.items, ...copy.copies] }), selection };
}


// ---- undo and redo (decision D6) ----

export interface EditorHistory { state: EditorState; undo(): EditorHistory; redo(): EditorHistory; push(next: EditorState): EditorHistory }

/** Per-gesture undo and redo: an immutable stack of editor states; the host pushes one state per completed gesture. */
function makeHistory(past: readonly EditorState[], state: EditorState, future: readonly EditorState[]): EditorHistory {
  return {
    state,
    undo(): EditorHistory {
      const previous = past[past.length - 1];
      return previous === undefined ? this : makeHistory(past.slice(0, -1), previous, [state, ...future]);
    },
    redo(): EditorHistory {
      const [next, ...rest] = future;
      return next === undefined ? this : makeHistory([...past, state], next, rest);
    },
    push(next: EditorState): EditorHistory {
      return makeHistory([...past, state], next, []);
    },
  };
}

/** A history whose current state is `state`, with nothing to undo or redo. */
export function createHistory(state: EditorState): EditorHistory {
  return makeHistory([], state, []);
}
