// Editor gestures as pure transitions (decisions D6 to D9): pointer down, move, up and double-click in grid units (y up) plus keys, applied to the editor state. The model only changes when a gesture completes; the drag lives in the draft until release.
import { pointRefs as refsOf, type DrawingModel, type Vec } from "../../../drawing/index.js";
import { dragSelection } from "./handles.js";
import { withGroups } from "./arrange.js";
import { addFreehand, clickVertex, dropVertex, finishFreehand, finishPath, insertVertex, placeNode } from "./shapeTools.js";
import { snapPosition } from "./snap.js";
import { clamp, curveOf, deleteSelection, draggedIds, duplicateSelection, gridSnap, IdSource, itemIndexOf, itemKey, place, pointById, r2, reflow, removeFromModel, same, selectedItemIndexes, selectedPointIds, startPoint, styled, targetKey, translate, type Draft, type EditorState, type Item } from "./state.js";

export type EditorEvent = { type: 'down' | 'move' | 'up' | 'dblclick'; x: number; y: number; shift: boolean; alt: boolean; mod: boolean; target: import("./state.js").HitTarget | null } | { type: 'key'; key: string; shift: boolean; mod: boolean }

type PointerEvent = Extract<EditorEvent, { type: 'down' | 'move' | 'up' | 'dblclick' }>;
type KeyEvent = Extract<EditorEvent, { type: 'key' }>;

/** Expression a new function starts with before its field is filled. */
const DEFAULT_EXPR = "x";

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
      if (target.kind === "handle") { return { ...base, draft: { kind: "handle", start: at, current: at, index: target.index, handle: target.handle } }; }
      const key = targetKey(target);
      // An item of a group stands for the whole group: Shift adds or removes all of it.
      const keys = withGroups(state.model, new Set([key]));
      let selection: ReadonlySet<string>;
      if (event.shift) {
        const next = new Set(state.selection);
        for (const k of keys) { if (state.selection.has(key)) { next.delete(k); } else { next.add(k); } }
        selection = next;
      } else {
        selection = state.selection.has(key) ? state.selection : keys;
      }
      return { ...base, selection, draft: startDraft("move", at, key, draggedIds(state, target, selection)) };
    }
    case "line": case "arrow": {
      const point = target?.kind === "point" ? pointById(state.model, target.id) : undefined;
      if (point) { return { ...base, draft: startDraft("join", { x: point.x, y: point.y }, point.id) }; }
      const snap = snapPosition(state.model, { x: at.x, y: at.y, shift: false, alt: event.alt, scale });
      return { ...base, draft: startDraft("join", { x: r2(snap.x), y: r2(snap.y) }, snap.pointId) };
    }
    case "freehand":
      return { ...base, draft: { kind: "path", start: at, current: at, path: [{ at }] } };
    case "polygon": case "curve": case "angle": case "node": case "label":
      return base;
  }
}

function finishMove(state: EditorState, draft: Draft, event: PointerEvent, scale: number): EditorState {
  const cur = { x: event.x, y: event.y };
  const ids = new Set(draft.ids ?? []);
  const key = draft.from ?? "";
  const done = { ...state, draft: null };
  if (same(cur, draft.start)) {
    return event.shift ? done : { ...done, selection: withGroups(state.model, new Set([key])) };
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
  const within = (v: Vec): boolean => v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1;
  const inside = new Set(state.model.points.filter(within).map((p) => p.id));
  // An item is taken when all its points are inside (a label: its place), and with it the rest of its group.
  const items = state.model.items.flatMap((item, i) => {
    const refs = refsOf(item);
    return (item.k === "text" ? within(item) : refs.length > 0 && refs.every((id) => inside.has(id))) ? [itemKey(i)] : [];
  });
  return { ...done, selection: withGroups(state.model, new Set([...(event.shift ? state.selection : []), ...inside, ...items])) };
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

/** A new function on the axes, with its expression field open. */
export function addFunction(state: EditorState, model: DrawingModel, axesId: string): EditorState {
  const fn: Item = { k: "fn", axes: axesId, expr: DEFAULT_EXPR, ...styled(state.style) };
  const key = itemKey(model.items.length);
  return { ...state, draft: null, model: { ...model, items: [...model.items, fn] }, selection: new Set([key]), editingLabel: key };
}

function onUp(state: EditorState, event: PointerEvent, scale: number, ids: IdSource): EditorState {
  const draft = state.draft;
  if (draft) {
    switch (draft.kind) {
      case "move": return finishMove(state, draft, event, scale);
      case "marquee": return finishMarquee(state, draft, event);
      case "join": return finishJoin(state, draft, event, scale, ids);
      case "path": return state.tool === "freehand" ? finishFreehand(state, ids) : clickVertex(state, event, scale, ids);
      case "handle": return { ...state, draft: null, model: dragSelection(state, { ...draft, current: { x: event.x, y: event.y }, shift: event.shift, alt: event.alt }, ids) };
    }
  }
  const at = { x: event.x, y: event.y };
  switch (state.tool) {
    case "point": {
      const placed = place(state.model, ids, at, event, scale, true);
      return { ...state, model: placed.model, selection: new Set([placed.id]) };
    }
    case "polygon": case "curve": case "angle":
      return clickVertex(state, event, scale, ids);
    case "node":
      return placeNode(state, event, scale, ids);
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
  if (state.draft?.kind === "path") { return finishPath(state, ids, false); }
  const base = { ...state, draft: null };
  const target = event.target;
  if (target?.kind === "handle") { return state; }
  const kind = target?.kind === "item" ? state.model.items[target.index]?.k : undefined;
  if (target?.kind === "item" && state.tool === "select" && (kind === "poly" || kind === "curve")) { return insertVertex(state, target.index, { x: event.x, y: event.y }, ids); }
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
  if (state.draft?.kind === "path" && event.key === "Enter") { return finishPath(state, ids, false); }
  if (state.draft?.kind === "path" && event.key === "Backspace") { return dropVertex(state); }
  if (state.draft) { return state; }
  const lower = event.key.toLowerCase();
  if (event.mod) { return lower === "d" ? duplicateSelection(state, ids) : state; }
  if (event.key === "Delete" || event.key === "Backspace") { return deleteSelection(state); }
  const direction = NUDGE[event.key];
  return direction ? nudgeSelection(state, direction, event.shift) : state;
}

/** Writes the open field's text into the model: a point, segment or angle label (empty removes it), a function's expression or a text item's TeX. Leaves the field open; Enter or Tab through applyEvent moves on. */
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
      case "seg": case "angle": {
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

/** The model as the canvas shows it while a drag runs: a move or a handle drag applied as releasing there would apply it. */
export function shownModel(state: EditorState, scale: number): DrawingModel {
  const d = state.draft;
  if (d?.kind === "handle") { return dragSelection(state, d, new IdSource(state)); }
  if (d?.kind !== "move") { return state.model; }
  return finishMove(state, d, { type: "up", x: d.current.x, y: d.current.y, shift: d.shift ?? false, alt: d.alt ?? false, mod: false, target: null }, scale).model;
}

/** Applies one editor event to the state; returns the same state when the event changes nothing. ⌘Z and ⇧⌘Z belong to the history and leave the state alone. */
export function applyEvent(state: import("./state.js").EditorState, event: EditorEvent, scale: number): import("./state.js").EditorState {
  const ids = new IdSource(state);
  let out: EditorState;
  switch (event.type) {
    case "key": out = onKey(state, event, ids); break;
    case "down": out = onDown(state, event, scale); break;
    case "move": out = state.draft ? addFreehand({ ...state, draft: { ...state.draft, current: { x: event.x, y: event.y }, shift: event.shift, alt: event.alt } }) : state; break;
    case "up": out = onUp(state, event, scale, ids); break;
    case "dblclick": out = onDoubleClick(state, event, scale, ids); break;
  }
  if (out !== state) { ids.remember(out); }
  return out;
}
