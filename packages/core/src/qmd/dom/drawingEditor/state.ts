// The drawing editor's state (decisions D6, D7, D9): the model being edited, the active tool, the selection (point ids and `i<index>` items), the open label or expression field, the gesture in progress and the style new items get.
import { parseExpr, pointRefs as refsOf, type DrawingModel, type DrawingStyle, type Vec } from "../../../drawing/index.js";

export type Tool = 'select' | 'point' | 'line' | 'arrow' | 'circle' | 'rect' | 'function' | 'label';

export type HitTarget = { kind: 'point'; id: string } | { kind: 'item'; index: number } | { kind: 'axes'; id: string; index: number }

export interface Draft { kind: 'move' | 'join' | 'marquee' | 'circle' | 'rect' | 'axes'; start: import("../../../drawing/index.js").Vec; current: import("../../../drawing/index.js").Vec; from?: string; ids?: string[] }

export interface EditorState { model: import("../../../drawing/index.js").DrawingModel; tool: Tool; selection: ReadonlySet<string>; editingLabel: string | null; draft: Draft | null; style: import("../../../drawing/index.js").DrawingStyle }

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
export function createEditorState(model: import("../../../drawing/index.js").DrawingModel): EditorState {
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
const counters = new WeakMap<EditorState, { p: number; a: number }>();

/** Hands out short ids (p1, p2, …; a1, a2, … for axes) not used in the model and not handed out before. */
export class IdSource {
  private readonly taken: Set<string>;
  private readonly next: { p: number; a: number };

  constructor(state: EditorState) {
    const model = state.model;
    this.taken = new Set([...model.points.map((p) => p.id), ...model.items.flatMap((item) => item.k === "axes" ? [item.id] : [])]);
    const seen = counters.get(state);
    this.next = { p: Math.max(seen?.p ?? 1, this.maxSuffix("p") + 1), a: Math.max(seen?.a ?? 1, this.maxSuffix("a") + 1) };
  }

  private maxSuffix(prefix: 'p' | 'a'): number {
    let max = 0;
    for (const id of this.taken) {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
      if (match) { max = Math.max(max, Number(match[1])); }
    }
    return max;
  }

  take(prefix: 'p' | 'a'): string {
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

/** Removes the points and items named, the items that name a removed point, and the functions of removed axes; renumbers `on` and drops it when its function went. */
export function removeFromModel(model: DrawingModel, pointIds: ReadonlySet<string>, itemIndexes: ReadonlySet<number>): DrawingModel {
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
    case "seg": case "rect": case "circle": case "poly":
      if (refsOf(item).every((ref) => copy.pointMap.has(ref))) {
        if (item.k === "seg" || item.k === "rect") { addCopy(copy, index, { ...item, a: mapped(item.a), b: mapped(item.b) }); }
        if (item.k === "circle") { addCopy(copy, index, { ...item, c: mapped(item.c) }); }
        if (item.k === "poly") { addCopy(copy, index, { ...item, pts: item.pts.map(mapped) }); }
      }
      break;
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
