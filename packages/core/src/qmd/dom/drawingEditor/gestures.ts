// Editor gestures as pure transitions (decisions D6 to D9): pointer down, move, up and double-click in grid units (y up) plus keys, applied to the editor state. The model only changes when a gesture completes; the drag lives in the draft until release.
import type { DrawingModel, Vec } from "../../../drawing/index.js";
import { snapPosition } from "./snap.js";
import { axesById, clamp, curveOf, deleteSelection, draggedIds, duplicateSelection, IdSource, itemIndexOf, itemKey, r2, reflow, removeFromModel, same, selectedItemIndexes, selectedPointIds, styled, targetKey, translate, type Draft, type EditorState, type HitTarget, type Item, type Point, type Tool } from "./state.js";

export type EditorEvent = { type: 'down' | 'move' | 'up' | 'dblclick'; x: number; y: number; shift: boolean; alt: boolean; mod: boolean; target: import("./state.js").HitTarget | null } | { type: 'key'; key: string; shift: boolean; mod: boolean }

type PointerEvent = Extract<EditorEvent, { type: 'down' | 'move' | 'up' | 'dblclick' }>;
type KeyEvent = Extract<EditorEvent, { type: 'key' }>;

/** Shortcut letters of the toolbar tools (D6). */
const TOOL_KEYS: Record<string, Tool> = { v: "select", p: "point", l: "line", a: "arrow", c: "circle", r: "rect", f: "function", t: "label" };
/** Grid units per math unit of new axes (D9: one math unit per two grid units). */
const AXES_SCALE = 2;
/** Expression a new function starts with before its field is filled. */
const DEFAULT_EXPR = "x";

// ---- placing points ----

interface Mods { shift: boolean; alt: boolean }

/** The id of the point at the snapped position: an existing point it snaps to, or a new one (on a curve when it snaps to one). */
function place(model: DrawingModel, ids: IdSource, at: Vec, mods: Mods, scale: number, dot: boolean, from?: Vec): { model: DrawingModel; id: string; created: boolean } {
  const snap = snapPosition(model, { x: at.x, y: at.y, shift: mods.shift, alt: mods.alt, scale, ...(from ? { from } : {}) });
  if (snap.pointId !== undefined) { return { model, id: snap.pointId, created: false }; }
  const point: Point = { id: ids.take("p"), x: r2(snap.x), y: r2(snap.y), dot, ...(snap.curve ? { on: { item: snap.curve.item, x: r2(snap.curve.x) } } : {}) };
  return { model: reflow({ ...model, points: [...model.points, point] }), id: point.id, created: true };
}

function pointById(model: DrawingModel, id: string | undefined): Point | undefined {
  return id === undefined ? undefined : model.points.find((p) => p.id === id);
}

/** A grid-snapped position (raw with Alt). */
function gridSnap(at: Vec, alt: boolean): Vec {
  return alt ? { x: r2(at.x), y: r2(at.y) } : { x: Math.round(at.x), y: Math.round(at.y) };
}

// ---- pointer ----

function startDraft(kind: Draft["kind"], start: Vec, from?: string, ids?: string[]): Draft {
  return { kind, start, current: start, ...(from !== undefined ? { from } : {}), ...(ids ? { ids } : {}) };
}

function onDown(state: EditorState, event: PointerEvent, scale: number): EditorState {
  const at = { x: event.x, y: event.y };
  const target = event.target;
  const base = { ...state, editingLabel: null };
  switch (state.tool) {
    // The Point tool always places a point on release (snapped, onto a curve too: D8), also over axes or an item.
    case "point":
      return base;
    case "select": {
      if (!target) { return { ...base, draft: startDraft("marquee", at) }; }
      const key = targetKey(target);
      let selection: ReadonlySet<string>;
      if (event.shift) {
        const next = new Set(state.selection);
        if (next.has(key)) { next.delete(key); } else { next.add(key); }
        selection = next;
      } else {
        selection = state.selection.has(key) ? state.selection : new Set([key]);
      }
      return { ...base, selection, draft: startDraft("move", at, key, draggedIds(state, target, selection)) };
    }
    case "line": case "arrow": case "circle": case "rect": {
      const point = target?.kind === "point" ? pointById(state.model, target.id) : undefined;
      if (point) { return { ...base, draft: startDraft(state.tool === "line" || state.tool === "arrow" ? "join" : state.tool, { x: point.x, y: point.y }, point.id) }; }
      const snap = snapPosition(state.model, { x: at.x, y: at.y, shift: false, alt: event.alt, scale });
      const kind = state.tool === "line" || state.tool === "arrow" ? "join" : state.tool;
      return { ...base, draft: startDraft(kind, { x: r2(snap.x), y: r2(snap.y) }, snap.pointId) };
    }
    case "function": {
      if (fnAxesOfTarget(state.model, target)) { return base; }
      return { ...base, draft: startDraft("axes", gridSnap(at, event.alt)) };
    }
    case "label":
      return base;
  }
}

/** The axes a Function-tool click shares: the target axes, or the axes of a target function. */
function fnAxesOfTarget(model: DrawingModel, target: HitTarget | null): string | undefined {
  if (!target) { return undefined; }
  if (target.kind === "axes") { return target.id; }
  if (target.kind === "item") {
    const item = model.items[target.index];
    if (item?.k === "fn") { return item.axes; }
    if (item?.k === "axes") { return item.id; }
  }
  return undefined;
}

function finishMove(state: EditorState, draft: Draft, event: PointerEvent, scale: number): EditorState {
  const cur = { x: event.x, y: event.y };
  const ids = new Set(draft.ids ?? []);
  const key = draft.from ?? "";
  const done = { ...state, draft: null };
  if (same(cur, draft.start)) {
    return event.shift ? done : { ...done, selection: new Set([key]) };
  }
  const model = state.model;
  const anchor = pointById(model, key);
  const textIndexes = new Set([...selectedItemIndexes(state)].filter((index) => model.items[index]?.k === "text"));
  const idx = itemIndexOf(key);
  if (idx !== null && model.items[idx]?.k === "text") { textIndexes.add(idx); }
  if (!anchor) {
    const delta = gridSnap({ x: cur.x - draft.start.x, y: cur.y - draft.start.y }, event.alt);
    return { ...done, model: translate(model, ids, textIndexes, delta.x, delta.y) };
  }
  const curve = anchor.on && curveOf(model, anchor.on.item);
  const onItem = anchor.on?.item;
  if (onItem !== undefined && curve && !ids.has(curve.origin.id)) {
    const onX = r2(clamp((cur.x - curve.origin.x) / curve.axes.sx, curve.range));
    const slid = reflow({ ...model, points: model.points.map((p) => p.id === anchor.id ? { ...p, on: { item: onItem, x: onX } } : p) });
    const after = pointById(slid, anchor.id) ?? anchor;
    ids.delete(anchor.id);
    return { ...done, model: translate(slid, ids, textIndexes, after.x - anchor.x, after.y - anchor.y) };
  }
  const snap = snapPosition(model, { x: cur.x, y: cur.y, shift: event.shift, alt: event.alt, scale, ...(event.shift ? { from: { x: anchor.x, y: anchor.y } } : {}) }, ids);
  const dx = r2(snap.x - anchor.x);
  const dy = r2(snap.y - anchor.y);
  let moved = translate(model, ids, textIndexes, dx, dy);
  if (ids.size === 1 && !anchor.on && snap.curve) {
    const on = { item: snap.curve.item, x: r2(snap.curve.x) };
    moved = reflow({ ...moved, points: moved.points.map((p) => p.id === anchor.id ? { ...p, on } : p) });
  }
  return { ...done, model: moved };
}

function finishMarquee(state: EditorState, draft: Draft, event: PointerEvent): EditorState {
  const cur = { x: event.x, y: event.y };
  const done = { ...state, draft: null };
  if (same(cur, draft.start)) { return event.shift ? done : { ...done, selection: new Set<string>() }; }
  const [x0, x1] = [Math.min(draft.start.x, cur.x), Math.max(draft.start.x, cur.x)];
  const [y0, y1] = [Math.min(draft.start.y, cur.y), Math.max(draft.start.y, cur.y)];
  const inside = state.model.points.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id);
  return { ...done, selection: new Set([...(event.shift ? state.selection : []), ...inside]) };
}

/** The draft's start point: the point it began on, or a new one at its start. */
function startPoint(model: DrawingModel, ids: IdSource, draft: Draft, dot: boolean): { model: DrawingModel; id: string } {
  const existing = pointById(model, draft.from);
  if (existing) { return { model, id: existing.id }; }
  const point: Point = { id: ids.take("p"), x: draft.start.x, y: draft.start.y, dot };
  return { model: { ...model, points: [...model.points, point] }, id: point.id };
}

function finishJoin(state: EditorState, draft: Draft, event: PointerEvent, scale: number, ids: IdSource): EditorState {
  const done = { ...state, draft: null };
  const cur = { x: event.x, y: event.y };
  const ignore = new Set(draft.from !== undefined ? [draft.from] : []);
  let endId: string | undefined = event.target?.kind === "point" ? event.target.id : undefined;
  if (endId === undefined) {
    const snap = snapPosition(state.model, { x: cur.x, y: cur.y, shift: event.shift, alt: event.alt, scale, from: draft.start }, ignore);
    if (snap.pointId !== undefined) { endId = snap.pointId; } else if (same({ x: r2(snap.x), y: r2(snap.y) }, draft.start)) { return done; }
  }
  if (endId !== undefined && endId === draft.from) { return done; }
  const begun = startPoint(state.model, ids, draft, true);
  let model = begun.model;
  if (endId === undefined) {
    const placed = place(model, ids, cur, event, scale, true, draft.start);
    model = placed.model;
    endId = placed.id;
  }
  if (endId === begun.id) { return done; }
  const seg: Item = { k: "seg", a: begun.id, b: endId, arrow: state.tool === "arrow" ? "end" : "none", ...styled(state.style) };
  return { ...done, model: { ...model, items: [...model.items, seg] }, selection: new Set([itemKey(model.items.length)]) };
}

function finishShape(state: EditorState, draft: Draft, event: PointerEvent, scale: number, ids: IdSource): EditorState {
  const done = { ...state, draft: null };
  const cur = { x: event.x, y: event.y };
  const ignore = new Set(draft.from !== undefined ? [draft.from] : []);
  const snap = snapPosition(state.model, { x: cur.x, y: cur.y, shift: false, alt: event.alt, scale }, ignore);
  let end: Vec = { x: r2(snap.x), y: r2(snap.y) };
  const begun = startPoint(state.model, ids, draft, false);
  let model = begun.model;
  if (draft.kind === "circle") {
    const r = r2(Math.hypot(end.x - draft.start.x, end.y - draft.start.y));
    if (!(r > 0)) { return done; }
    const circle: Item = { k: "circle", c: begun.id, r, ...styled(state.style) };
    return { ...done, model: { ...model, items: [...model.items, circle] }, selection: new Set([itemKey(model.items.length)]) };
  }
  let endId = event.shift ? undefined : snap.pointId;
  if (event.shift) {
    const side = Math.max(Math.abs(end.x - draft.start.x), Math.abs(end.y - draft.start.y));
    end = { x: r2(draft.start.x + Math.sign(end.x - draft.start.x || 1) * side), y: r2(draft.start.y + Math.sign(end.y - draft.start.y || 1) * side) };
  }
  if (end.x === draft.start.x || end.y === draft.start.y) { return done; }
  if (endId === undefined) {
    const corner: Point = { id: ids.take("p"), x: end.x, y: end.y, dot: false };
    model = { ...model, points: [...model.points, corner] };
    endId = corner.id;
  }
  const rect: Item = { k: "rect", a: begun.id, b: endId, ...styled(state.style) };
  return { ...done, model: { ...model, items: [...model.items, rect] }, selection: new Set([itemKey(model.items.length)]) };
}

/** A new function on the axes, with its expression field open. */
function addFunction(state: EditorState, model: DrawingModel, axesId: string): EditorState {
  const fn: Item = { k: "fn", axes: axesId, expr: DEFAULT_EXPR, ...styled(state.style) };
  const key = itemKey(model.items.length);
  return { ...state, draft: null, model: { ...model, items: [...model.items, fn] }, selection: new Set([key]), editingLabel: key };
}

/** Axes filling the dragged box (one math unit per two grid units, origin snapped inside) and a function on them. */
function finishAxes(state: EditorState, draft: Draft, event: PointerEvent, ids: IdSource): EditorState {
  const end = gridSnap({ x: event.x, y: event.y }, event.alt);
  const [x0, x1] = [Math.min(draft.start.x, end.x), Math.max(draft.start.x, end.x)];
  const [y0, y1] = [Math.min(draft.start.y, end.y), Math.max(draft.start.y, end.y)];
  if (!(x1 > x0) || !(y1 > y0)) { return { ...state, draft: null }; }
  const inside = (lo: number, hi: number): number => clamp(Math.round((lo + hi) / 2), [lo, hi]);
  const origin: Point = { id: ids.take("p"), x: r2(inside(x0, x1)), y: r2(inside(y0, y1)), dot: false };
  const axes: Item = {
    k: "axes", id: ids.take("a"), o: origin.id,
    x: [r2((x0 - origin.x) / AXES_SCALE), r2((x1 - origin.x) / AXES_SCALE)],
    y: [r2((y0 - origin.y) / AXES_SCALE), r2((y1 - origin.y) / AXES_SCALE)],
    sx: AXES_SCALE, sy: AXES_SCALE, ticks: true,
  };
  const model = { ...state.model, points: [...state.model.points, origin], items: [...state.model.items, axes] };
  return addFunction(state, model, axes.id);
}

function onUp(state: EditorState, event: PointerEvent, scale: number, ids: IdSource): EditorState {
  const draft = state.draft;
  if (draft) {
    switch (draft.kind) {
      case "move": return finishMove(state, draft, event, scale);
      case "marquee": return finishMarquee(state, draft, event);
      case "join": return finishJoin(state, draft, event, scale, ids);
      case "circle": case "rect": return finishShape(state, draft, event, scale, ids);
      case "axes": return finishAxes(state, draft, event, ids);
    }
  }
  const at = { x: event.x, y: event.y };
  switch (state.tool) {
    case "point": {
      const placed = place(state.model, ids, at, event, scale, true);
      return { ...state, model: placed.model, selection: new Set([placed.id]) };
    }
    case "function": {
      const axesId = fnAxesOfTarget(state.model, event.target);
      return axesId !== undefined && axesById(state.model, axesId) ? addFunction(state, state.model, axesId) : state;
    }
    case "label": {
      const target = event.target;
      if (target) { return { ...state, editingLabel: targetKey(target) }; }
      const text: Item = { k: "text", x: r2(gridSnap(at, event.alt).x), y: r2(gridSnap(at, event.alt).y), tex: "" };
      const key = itemKey(state.model.items.length);
      return { ...state, model: { ...state.model, items: [...state.model.items, text] }, selection: new Set([key]), editingLabel: key };
    }
    default:
      return state;
  }
}

/** Double-click: a point or labelled item opens its field; empty canvas makes a point and opens its label (D7); axes open their ranges and labels (D9). */
function onDoubleClick(state: EditorState, event: PointerEvent, scale: number, ids: IdSource): EditorState {
  const base = { ...state, draft: null };
  const target = event.target;
  if (target) {
    const key = targetKey(target);
    return { ...base, selection: new Set([key]), editingLabel: key };
  }
  const placed = place(state.model, ids, { x: event.x, y: event.y }, event, scale, true);
  return { ...base, model: placed.model, selection: new Set([placed.id]), editingLabel: placed.id };
}

// ---- keys ----

/** Removes a text item left empty when its field closes. */
function dropEmptyText(state: EditorState): EditorState {
  const index = state.editingLabel === null ? null : itemIndexOf(state.editingLabel);
  const item = index === null ? undefined : state.model.items[index];
  if (index === null || item?.k !== "text" || item.tex !== "") { return state; }
  return { ...state, model: removeFromModel(state.model, new Set(), new Set([index])), selection: new Set<string>() };
}

/** Enter confirms, Esc closes, Tab moves to the next point (Shift+Tab the previous) (D7). */
function onEditingKey(state: EditorState, event: KeyEvent): EditorState {
  const editing = state.editingLabel;
  if (editing === null) { return state; }
  if (event.key === "Enter" || event.key === "Escape") { return { ...dropEmptyText(state), editingLabel: null }; }
  if (event.key !== "Tab") { return state; }
  const points = state.model.points;
  const at = points.findIndex((p) => p.id === editing);
  if (at < 0 || points.length === 0) { return { ...dropEmptyText(state), editingLabel: null }; }
  const next = points[(at + (event.shift ? points.length - 1 : 1)) % points.length];
  return next ? { ...state, editingLabel: next.id, selection: new Set([next.id]) } : state;
}

const NUDGE: Record<string, Vec> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 } };

function nudgeSelection(state: EditorState, direction: Vec, shift: boolean): EditorState {
  const step = shift ? 5 : 1;
  const textIndexes = new Set([...selectedItemIndexes(state)].filter((index) => state.model.items[index]?.k === "text"));
  const ids = selectedPointIds(state);
  if (ids.size === 0 && textIndexes.size === 0) { return state; }
  return { ...state, model: translate(state.model, ids, textIndexes, direction.x * step, direction.y * step) };
}

function onKey(state: EditorState, event: KeyEvent, ids: IdSource): EditorState {
  if (state.editingLabel !== null) { return onEditingKey(state, event); }
  if (event.key === "Escape") { return state.draft ? { ...state, draft: null } : { ...state, selection: new Set<string>() }; }
  if (state.draft) { return state; }
  const lower = event.key.toLowerCase();
  if (event.mod) { return lower === "d" ? duplicateSelection(state, ids) : state; }
  if (event.key === "Delete" || event.key === "Backspace") { return deleteSelection(state); }
  const direction = NUDGE[event.key];
  if (direction) { return nudgeSelection(state, direction, event.shift); }
  const tool = TOOL_KEYS[lower];
  return tool && !event.shift ? { ...state, tool } : state;
}

/** Writes the open field's text into the model: a point or segment label (empty removes it), a function's expression or a text item's TeX. Leaves the field open; Enter or Tab through applyEvent moves on. */
export function commitLabel(state: EditorState, text: string): EditorState {
  const key = state.editingLabel;
  if (key === null) { return state; }
  const index = itemIndexOf(key);
  const model = state.model;
  if (index === null) {
    const points = model.points.map((point) => {
      if (point.id !== key) { return point; }
      const { label: _label, ...rest } = point;
      return text === "" ? rest : { ...point, label: text };
    });
    return { ...state, model: { ...model, points } };
  }
  const items = model.items.map((item, at) => {
    if (at !== index) { return item; }
    switch (item.k) {
      case "seg": {
        const { label: _label, ...rest } = item;
        return text === "" ? rest : { ...item, label: text };
      }
      case "fn": return { ...item, expr: text };
      case "text": return { ...item, tex: text };
      default: return item;
    }
  });
  return { ...state, model: reflow({ ...model, items }) };
}

/** Applies one editor event to the state; returns the same state when the event changes nothing. ⌘Z and ⇧⌘Z belong to the history and leave the state alone. */
export function applyEvent(state: import("./state.js").EditorState, event: EditorEvent, scale: number): import("./state.js").EditorState {
  const ids = new IdSource(state);
  let out: EditorState;
  switch (event.type) {
    case "key": out = onKey(state, event, ids); break;
    case "down": out = onDown(state, event, scale); break;
    case "move": out = state.draft ? { ...state, draft: { ...state.draft, current: { x: event.x, y: event.y } } } : state; break;
    case "up": out = onUp(state, event, scale, ids); break;
    case "dblclick": out = onDoubleClick(state, event, scale, ids); break;
  }
  if (out !== state) { ids.remember(out); }
  return out;
}
