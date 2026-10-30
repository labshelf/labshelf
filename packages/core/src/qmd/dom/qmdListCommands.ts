// Holds the list editing commands of the rich Markdown editor: Enter, Tab and Shift-Tab in list items, and the Insert menu's list toggles.
import { Fragment, NodeRange, Slice, type Node as ProseNode, type NodeType } from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { canJoin, canSplit, findWrapping, liftTarget, ReplaceAroundStep } from "prosemirror-transform";
import { qmdSchema } from "../editor/index.js";

const listNodes = {
  bullet_list: qmdSchema.nodes.bullet_list!,
  ordered_list: qmdSchema.nodes.ordered_list!,
  list_item: qmdSchema.nodes.list_item!,
  task_item: qmdSchema.nodes.task_item!,
};

const isItem = (node: ProseNode | null | undefined): boolean => node?.type === listNodes.list_item || node?.type === listNodes.task_item;

/** The list range around the selection, whose parent is a list. */
function listRange(state: EditorState): NodeRange | null {
  const { $from, $to } = state.selection;
  return $from.blockRange($to, (node) => node.childCount > 0 && isItem(node.firstChild));
}

/** Enter in a list or task item: splits it, or lifts it out when its paragraph is empty. */
export const splitItem: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if ($from.depth < 2 || !$from.sameParent($to) || !isItem($from.node(-1))) return false;
  const item = $from.node(-1);
  if ($from.parent.content.size === 0 && $from.node(-1).childCount === 1) return liftItem(state, dispatch);
  const fresh = item.type === listNodes.task_item ? { checked: false } : {};
  const nextType = $to.pos === $from.end() ? item.contentMatchAt(0).defaultType : null;
  const types = [{ type: item.type, attrs: fresh }, ...(nextType ? [{ type: nextType }] : [])];
  const tr = state.tr;
  if (state.selection.from !== state.selection.to) tr.deleteSelection();
  const pos = tr.mapping.map($from.pos);
  if (!canSplit(tr.doc, pos, 2, types)) return false;
  dispatch?.(tr.split(pos, 2, types).scrollIntoView());
  return true;
};

/** Shift-Tab: lifts the selected items to the outer list, or out of the list. */
export const liftItem: Command = (state, dispatch) => {
  const range = listRange(state);
  if (!range) return false;
  if (!dispatch) return true;
  return isItem(state.selection.$from.node(range.depth - 1)) ? liftToOuterList(state, dispatch, range) : liftOutOfList(state, dispatch, range);
};

function liftToOuterList(state: EditorState, dispatch: (tr: Transaction) => void, initial: NodeRange): boolean {
  let range = initial;
  const tr = state.tr;
  const end = range.end;
  const endOfList = state.selection.$to.end(range.depth);
  const itemType = state.selection.$from.node(range.depth - 1).type;
  if (end < endOfList) {
    tr.step(new ReplaceAroundStep(end - 1, endOfList, end, endOfList, new Slice(Fragment.from(itemType.create(null, range.parent.copy())), 1, 0), 1, true));
    range = new NodeRange(tr.doc.resolve(range.$from.pos), tr.doc.resolve(endOfList), range.depth);
  }
  const target = liftTarget(range);
  if (target === null) return false;
  tr.lift(range, target);
  const $after = tr.doc.resolve(tr.mapping.map(end, -1) - 1);
  if (canJoin(tr.doc, $after.pos) && $after.nodeBefore?.type === $after.nodeAfter?.type) tr.join($after.pos);
  dispatch(tr.scrollIntoView());
  return true;
}

function liftOutOfList(state: EditorState, dispatch: (tr: Transaction) => void, range: NodeRange): boolean {
  const tr = state.tr;
  const list = range.parent;
  for (let pos = range.end, i = range.endIndex - 1; i > range.startIndex; i--) {
    pos -= list.child(i).nodeSize;
    tr.delete(pos - 1, pos + 1);
  }
  const $start = tr.doc.resolve(range.start);
  const item = $start.nodeAfter;
  if (!item || tr.mapping.map(range.end) !== range.start + item.nodeSize) return false;
  const atStart = range.startIndex === 0;
  const atEnd = range.endIndex === list.childCount;
  const parent = $start.node(-1);
  const indexBefore = $start.index(-1);
  if (!parent.canReplace(indexBefore + (atStart ? 0 : 1), indexBefore + 1, item.content.append(atEnd ? Fragment.empty : Fragment.from(list)))) return false;
  const start = $start.pos;
  const end = start + item.nodeSize;
  const shell = (keep: boolean): Fragment => (keep ? Fragment.empty : Fragment.from(list.copy(Fragment.empty)));
  tr.step(new ReplaceAroundStep(start - (atStart ? 1 : 0), end + (atEnd ? 1 : 0), start + 1, end - 1, new Slice(shell(atStart).append(shell(atEnd)), atStart ? 0 : 1, atEnd ? 0 : 1), atStart ? 0 : 1));
  dispatch(tr.scrollIntoView());
  return true;
}

/** Tab: nests the selected items under the item before them. */
export const sinkItem: Command = (state, dispatch) => {
  const range = listRange(state);
  if (!range || range.startIndex === 0) return false;
  const parent = range.parent;
  const nodeBefore = parent.child(range.startIndex - 1);
  if (!isItem(nodeBefore)) return false;
  if (!dispatch) return true;
  const itemType: NodeType = parent.child(range.startIndex).type;
  const nestedBefore = nodeBefore.lastChild?.type === parent.type;
  const inner = Fragment.from(nestedBefore ? itemType.create() : null);
  const slice = new Slice(Fragment.from(itemType.create(null, Fragment.from(parent.type.create(null, inner)))), nestedBefore ? 3 : 1, 0);
  const before = range.start;
  const after = range.end;
  dispatch(state.tr.step(new ReplaceAroundStep(before - (nestedBefore ? 3 : 1), after, before, after, slice, 1, true)).scrollIntoView());
  return true;
};

type ListKind = "bullet" | "ordered" | "task";

function listKind(range: NodeRange): ListKind {
  if (range.parent.type === listNodes.ordered_list) return "ordered";
  return range.parent.child(range.startIndex).type === listNodes.task_item ? "task" : "bullet";
}

/** Wraps the selected blocks in a new list of `kind`. */
function wrapList(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, kind: ListKind): boolean {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  const wrapping = range && findWrapping(range, kind === "ordered" ? listNodes.ordered_list : listNodes.bullet_list);
  if (!range || !wrapping) return false;
  const wrappers = kind === "task" ? wrapping.map((wrapper) => (wrapper.type === listNodes.list_item ? { type: listNodes.task_item, attrs: { checked: false } } : wrapper)) : wrapping;
  dispatch?.(state.tr.wrap(range, wrappers).scrollIntoView());
  return true;
}

/** Turns the list around the selection into a list of `kind`, resetting each item's written prefix. */
function convertList(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, range: NodeRange, kind: ListKind): boolean {
  if (!dispatch) return true;
  const list = range.parent;
  const listPos = range.$from.before(range.depth);
  const tr = state.tr;
  const setList = (): void => {
    const type = kind === "ordered" ? listNodes.ordered_list : listNodes.bullet_list;
    if (type !== list.type) tr.setNodeMarkup(listPos, type, { gap: list.attrs.gap as string | null });
  };
  const setItems = (): void => {
    list.forEach((item, offset) => {
      const gap = item.attrs.gap as string | null;
      const attrs = kind === "task" ? { checked: item.type === listNodes.task_item ? item.attrs.checked : false, gap } : { gap };
      tr.setNodeMarkup(listPos + 1 + offset, kind === "task" ? listNodes.task_item : listNodes.list_item, attrs);
    });
  };
  // An ordered list accepts only list items, so the list changes first when items become tasks and last otherwise.
  if (kind === "task") {
    setList();
    setItems();
  } else {
    setItems();
    setList();
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/** Wraps the selection in a list of `kind`, lifts it out of one of that kind, or converts another kind of list. */
export function toggleList(kind: ListKind): Command {
  return (state, dispatch) => {
    const range = listRange(state);
    if (!range) return wrapList(state, dispatch, kind);
    if (listKind(range) === kind) return liftItem(state, dispatch);
    return convertList(state, dispatch, range, kind);
  };
}

export function listActive(kind: ListKind): (state: EditorState) => boolean {
  return (state) => {
    const range = listRange(state);
    return range !== null && listKind(range) === kind;
  };
}
