// Arranging the selection, as pure transitions in grid units (y up): items of a group are selected together; grouping and
// ungrouping; bringing to the front or sending to the back (the drawing order, renumbering what names items by index);
// aligning the selected objects (a group counts as one) on their left, centre, right, top, middle or bottom; flipping the
// selection about its centre.
import { pointRefs, type DrawingModel } from "../../../drawing/index.js";
import { itemIndexOf, itemKey, selectedItemIndexes, translate, type EditorState, type IdSource, type Item } from "./state.js";
import { applyAffine, selectionBox } from "./transform.js";

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** The selection with every item of a group any selected item belongs to. */
export function withGroups(model: DrawingModel, selection: ReadonlySet<string>): ReadonlySet<string> {
  const groups = new Set([...selection].flatMap((key) => { const i = itemIndexOf(key); const g = i === null ? undefined : model.items[i]?.g; return g ? [g] : []; }));
  if (groups.size === 0) { return selection; }
  return new Set([...selection, ...model.items.flatMap((item, i) => (item.g && groups.has(item.g) ? [itemKey(i)] : []))]);
}

function setItems(state: EditorState, change: (item: Item, index: number) => Item): EditorState {
  return { ...state, model: { ...state.model, items: state.model.items.map(change) } };
}

/** Puts the selected items (two or more) in one new group. */
export function groupSelection(state: EditorState, ids: IdSource): EditorState {
  const selected = selectedItemIndexes(state);
  if (selected.size < 2) { return state; }
  const g = ids.take("g");
  return setItems(state, (item, i) => (selected.has(i) ? { ...item, g } : item));
}

/** Takes the selected items out of their groups. */
export function ungroupSelection(state: EditorState): EditorState {
  const selected = selectedItemIndexes(state);
  if (![...selected].some((i) => state.model.items[i]?.g)) { return state; }
  return setItems(state, (item, i) => { if (!selected.has(i) || !item.g) { return item; } const { g: _g, ...rest } = item; return rest as Item; });
}

/** Moves the selected items to the end (front) or the start (back) of the drawing order, keeping their own order. */
export function reorderSelection(state: EditorState, where: 'front' | 'back'): EditorState {
  const selected = selectedItemIndexes(state);
  const all = state.model.items.map((_item, i) => i);
  const rest = all.filter((i) => !selected.has(i));
  const moved = all.filter((i) => selected.has(i));
  const order = where === "front" ? [...rest, ...moved] : [...moved, ...rest];
  if (order.every((old, i) => old === i)) { return state; }
  const to = new Map(order.map((old, i) => [old, i]));
  const points = state.model.points.map((p) => (p.on ? { ...p, on: { ...p.on, item: to.get(p.on.item) ?? p.on.item } } : p));
  const selection = new Set([...state.selection].map((key) => { const i = itemIndexOf(key); return i === null ? key : itemKey(to.get(i) ?? i); }));
  return { ...state, model: { ...state.model, points, items: order.map((old) => state.model.items[old]!) }, selection };
}

/** The selected objects: each group as one, each other item on its own, as selection keys. */
function units(state: EditorState): Array<Set<string>> {
  const byGroup = new Map<string, Set<string>>();
  const out: Array<Set<string>> = [];
  for (const i of selectedItemIndexes(state)) {
    const g = state.model.items[i]!.g;
    if (!g) { out.push(new Set([itemKey(i)])); continue; }
    if (!byGroup.has(g)) { const keys = new Set<string>(); byGroup.set(g, keys); out.push(keys); }
    byGroup.get(g)!.add(itemKey(i));
  }
  return out;
}

/** Lines the selected objects (two or more) up on the edge or centre line of the box around them all. */
export function alignSelection(state: EditorState, edge: AlignEdge): EditorState {
  const all = selectionBox(state);
  const objects = units(state).map((keys) => ({ keys, box: selectionBox({ ...state, selection: keys }) }));
  if (!all || objects.length < 2) { return state; }
  const target = (b: NonNullable<typeof all>): number => ({ left: b.x0, center: (b.x0 + b.x1) / 2, right: b.x1, top: b.y1, middle: (b.y0 + b.y1) / 2, bottom: b.y0 })[edge];
  const horizontal = edge === "left" || edge === "center" || edge === "right";
  let model = state.model;
  for (const { keys, box } of objects) {
    if (!box) { continue; }
    const shift = target(all) - target(box);
    const indexes = [...keys].map((k) => itemIndexOf(k)!);
    const ids = new Set(indexes.flatMap((i) => pointRefs(model.items[i]!)));
    const texts = new Set(indexes.filter((i) => model.items[i]!.k === "text"));
    model = translate(model, ids, texts, horizontal ? shift : 0, horizontal ? 0 : shift);
  }
  return { ...state, model };
}

/** Mirrors the selection left to right (h) or top to bottom (v) about the centre of its box. */
export function flipSelection(state: EditorState, axis: 'h' | 'v', ids: IdSource): EditorState {
  const box = selectionBox(state);
  if (!box) { return state; }
  const o = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  return { ...state, model: applyAffine(state, { m: axis === "h" ? [-1, 0, 0, 1] : [1, 0, 0, -1], o }, ids) };
}
