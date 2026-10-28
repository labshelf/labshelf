// Holds the editing commands of the rich Markdown editor, shared by its keymap and its formatting toolbar: marks, headings, lists, math, code cells and links.
import { setBlockType, toggleMark } from "prosemirror-commands";
import { Fragment, NodeRange, Slice, type Mark, type MarkType, type Node as ProseNode, type NodeType } from "prosemirror-model";
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { canJoin, canSplit, findWrapping, liftTarget, ReplaceAroundStep } from "prosemirror-transform";
import type { IconName } from "../../ui/icons/index.js";
import { askInputBox, type InputBoxOptions } from "../../ui/dom/index.js";
import { qmdSchema } from "../editor/index.js";

const nodes = {
  paragraph: qmdSchema.nodes.paragraph!,
  heading: qmdSchema.nodes.heading!,
  bullet_list: qmdSchema.nodes.bullet_list!,
  ordered_list: qmdSchema.nodes.ordered_list!,
  list_item: qmdSchema.nodes.list_item!,
  task_item: qmdSchema.nodes.task_item!,
  math_inline: qmdSchema.nodes.math_inline!,
  math_display: qmdSchema.nodes.math_display!,
  code_cell: qmdSchema.nodes.code_cell!,
};
const marks = { strong: qmdSchema.marks.strong!, em: qmdSchema.marks.em!, link: qmdSchema.marks.link! };

/** Formats a ProseMirror key such as `Mod-Shift-m` for a title: `⌘⇧M` on Apple platforms, `Ctrl+Shift+M` elsewhere. */
export function shortcutLabel(key: string): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = key.split("-").map((part, index, all) => {
    if (index === all.length - 1) return part.length === 1 ? part.toUpperCase() : part;
    if (part === "Mod") return mac ? "⌘" : "Ctrl";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    return mac ? "⌃" : "Ctrl";
  });
  return parts.join(mac ? "" : "+");
}

const isItem = (node: ProseNode | null | undefined): boolean => node?.type === nodes.list_item || node?.type === nodes.task_item;

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
  const fresh = item.type === nodes.task_item ? { checked: false } : {};
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

function markActive(type: MarkType): (state: EditorState) => boolean {
  return (state) => {
    const { from, to, empty, $from } = state.selection;
    if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
    return state.doc.rangeHasMark(from, to, type);
  };
}

/** Sets the selected textblocks to a heading of `level`, or to a paragraph for level 0 or the same level again. */
function setHeading(level: number): Command {
  return (state, dispatch) => {
    const parent = state.selection.$from.parent;
    const same = level > 0 && parent.type === nodes.heading && parent.attrs.level === level;
    if (level === 0 || same) return setBlockType(nodes.paragraph)(state, dispatch);
    return setBlockType(nodes.heading, { level })(state, dispatch);
  };
}

function headingActive(level: number): (state: EditorState) => boolean {
  return (state) => {
    const parent = state.selection.$from.parent;
    return level === 0 ? parent.type === nodes.paragraph : parent.type === nodes.heading && parent.attrs.level === level;
  };
}

type ListKind = "bullet" | "ordered" | "task";

function listKind(range: NodeRange): ListKind {
  if (range.parent.type === nodes.ordered_list) return "ordered";
  return range.parent.child(range.startIndex).type === nodes.task_item ? "task" : "bullet";
}

/** Wraps the selected blocks in a new list of `kind`. */
function wrapList(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, kind: ListKind): boolean {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  const wrapping = range && findWrapping(range, kind === "ordered" ? nodes.ordered_list : nodes.bullet_list);
  if (!range || !wrapping) return false;
  const wrappers = kind === "task" ? wrapping.map((wrapper) => (wrapper.type === nodes.list_item ? { type: nodes.task_item, attrs: { checked: false } } : wrapper)) : wrapping;
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
    const type = kind === "ordered" ? nodes.ordered_list : nodes.bullet_list;
    if (type !== list.type) tr.setNodeMarkup(listPos, type, { gap: list.attrs.gap as string | null });
  };
  const setItems = (): void => {
    list.forEach((item, offset) => {
      const gap = item.attrs.gap as string | null;
      const attrs = kind === "task" ? { checked: item.type === nodes.task_item ? item.attrs.checked : false, gap } : { gap };
      tr.setNodeMarkup(listPos + 1 + offset, kind === "task" ? nodes.task_item : nodes.list_item, attrs);
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
function toggleList(kind: ListKind): Command {
  return (state, dispatch) => {
    const range = listRange(state);
    if (!range) return wrapList(state, dispatch, kind);
    if (listKind(range) === kind) return liftItem(state, dispatch);
    return convertList(state, dispatch, range, kind);
  };
}

function listActive(kind: ListKind): (state: EditorState) => boolean {
  return (state) => {
    const range = listRange(state);
    return range !== null && listKind(range) === kind;
  };
}

/** Turns the selected text of one textblock into inline math, or a selected inline math back into text. */
const toggleInlineMath: Command = (state, dispatch) => {
  const selection = state.selection;
  if (selection instanceof NodeSelection && selection.node.type === nodes.math_inline) {
    if (!dispatch) return true;
    const tex = selection.node.attrs.tex as string;
    const tr = tex ? state.tr.replaceSelectionWith(qmdSchema.text(tex), false) : state.tr.deleteSelection();
    if (tex) tr.setSelection(TextSelection.create(tr.doc, selection.from, selection.from + tex.length));
    dispatch(tr.scrollIntoView());
    return true;
  }
  const { $from, $to } = selection;
  if (!(selection instanceof TextSelection) || !$from.sameParent($to) || !$from.parent.inlineContent) return false;
  if (!$from.parent.canReplaceWith($from.index(), $to.indexAfter(), nodes.math_inline)) return false;
  if (!dispatch) return true;
  const tex = state.doc.textBetween(selection.from, selection.to);
  const tr = state.tr.replaceSelectionWith(nodes.math_inline.create({ tex }), false);
  tr.setSelection(NodeSelection.create(tr.doc, selection.from));
  dispatch(tr.scrollIntoView());
  return true;
};

const inlineMathActive = (state: EditorState): boolean => state.selection instanceof NodeSelection && state.selection.node.type === nodes.math_inline;

/** Inserts a block made by `create`: in place of an empty paragraph, or after the current block. */
function insertBlock(create: () => ProseNode): Command {
  return (state, dispatch) => {
    const node = create();
    const selection = state.selection;
    let from: number;
    let to: number;
    if (selection.$from.parent.isTextblock) {
      const $pos = selection.$from;
      const container = $pos.node(-1);
      const index = $pos.index(-1);
      const empty = $pos.parent.type === nodes.paragraph && $pos.parent.content.size === 0;
      if (empty && container.canReplaceWith(index, index + 1, node.type)) [from, to] = [$pos.before(), $pos.after()];
      else if (container.canReplaceWith(index + 1, index + 1, node.type)) from = to = $pos.after();
      else return false;
    } else if (selection instanceof NodeSelection && selection.node.isBlock) {
      const index = selection.$from.index();
      if (!selection.$from.parent.canReplaceWith(index + 1, index + 1, node.type)) return false;
      from = to = selection.to;
    } else {
      return false;
    }
    if (!dispatch) return true;
    const tr = state.tr.replaceWith(from, to, node);
    tr.setSelection(NodeSelection.create(tr.doc, from));
    if (from + node.nodeSize === tr.doc.content.size) tr.insert(tr.doc.content.size, nodes.paragraph.create());
    dispatch(tr.scrollIntoView());
    return true;
  };
}

interface LinkRange { from: number; to: number; href: string }

/** The run of text around the selection that carries one link mark, or null. */
function linkAt(state: EditorState): LinkRange | null {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to)) return null;
  let run: { from: number; to: number; mark: Mark } | null = null;
  let pos = $from.start();
  for (let i = 0; i < $from.parent.childCount; i++) {
    const child = $from.parent.child(i);
    const mark = marks.link.isInSet(child.marks);
    if (!mark) run = null;
    else if (run && run.mark.eq(mark)) run.to = pos + child.nodeSize;
    else run = { from: pos, to: pos + child.nodeSize, mark };
    pos += child.nodeSize;
    if (run && run.from <= $from.pos && $to.pos <= run.to && (i === $from.parent.childCount - 1 || !run.mark.isInSet($from.parent.child(i + 1).marks))) {
      return { from: run.from, to: run.to, href: run.mark.attrs.href as string };
    }
  }
  return null;
}

const UNSAFE_LINK = /^\s*javascript:/i;

/**
 * Asks for a link target through `ask` and sets it on the selection, or on the link around the cursor; an empty
 * answer removes the link, and a cursor outside a link inserts the target as linked text.
 */
function linkCommand(ask: (opts: InputBoxOptions) => Promise<string | undefined> = askInputBox): Command {
  return (state, dispatch, view) => {
    const selection = state.selection;
    if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return false;
    const parent = selection.$from.parent;
    if (!parent.inlineContent || !parent.type.allowsMarkType(marks.link)) return false;
    if (!dispatch || !view) return true;
    const existing = linkAt(state);
    const range = existing && selection.empty ? existing : { from: selection.from, to: selection.to };
    const validate = (value: string): string | null => (UNSAFE_LINK.test(value) ? "javascript: links are not allowed" : null);
    void ask({ title: "Link", value: existing?.href ?? "", placeholder: "https://…", validate }).then((answer) => {
      if (view.isDestroyed) return;
      const href = answer?.trim();
      if (href !== undefined) {
        const size = view.state.doc.content.size;
        const [from, to] = [Math.min(range.from, size), Math.min(range.to, size)];
        const tr = view.state.tr;
        if (!href) tr.removeMark(from, to, marks.link);
        else if (from === to) tr.insert(from, qmdSchema.text(href, [marks.link.create({ href })]));
        else tr.removeMark(from, to, marks.link).addMark(from, to, marks.link.create({ href }));
        if (tr.docChanged) view.dispatch(tr);
      }
      view.focus();
    });
    return true;
  };
}

export interface QmdAction { id: string; label: string; icon: IconName; shortcut: string; command: Command; active?: (state: EditorState) => boolean }

/** The toolbar actions other than headings, keyed by id. */
export const QMD_ACTIONS = {
  bold: { id: "bold", label: "Bold", icon: "bold", shortcut: "Mod-b", command: toggleMark(marks.strong), active: markActive(marks.strong) },
  italic: { id: "italic", label: "Italic", icon: "italic", shortcut: "Mod-i", command: toggleMark(marks.em), active: markActive(marks.em) },
  bullet: { id: "bullet", label: "Bullet list", icon: "list", shortcut: "Mod-Shift-8", command: toggleList("bullet"), active: listActive("bullet") },
  ordered: { id: "ordered", label: "Numbered list", icon: "list-ordered", shortcut: "Mod-Shift-7", command: toggleList("ordered"), active: listActive("ordered") },
  task: { id: "task", label: "Task list", icon: "check-square", shortcut: "Mod-Shift-9", command: toggleList("task"), active: listActive("task") },
  inlineMath: { id: "inlineMath", label: "Inline math", icon: "sigma", shortcut: "Mod-m", command: toggleInlineMath, active: inlineMathActive },
  displayMath: { id: "displayMath", label: "Display math", icon: "sigma-block", shortcut: "Mod-Shift-m", command: insertBlock(() => nodes.math_display.create()) },
  codeCell: { id: "codeCell", label: "Code cell", icon: "code", shortcut: "Mod-Alt-c", command: insertBlock(() => nodes.code_cell.create({ lang: "python" })) },
  link: { id: "link", label: "Link", icon: "link", shortcut: "Mod-k", command: linkCommand(), active: (state: EditorState) => linkAt(state) !== null },
} satisfies Record<string, QmdAction>;

export interface QmdHeading { level: number; label: string; shortcut: string; command: Command; active: (state: EditorState) => boolean }

/** Paragraph and headings 1 to 3, in menu order. */
export const QMD_HEADINGS: readonly QmdHeading[] = [0, 1, 2, 3].map((level) => ({
  level,
  label: level === 0 ? "Paragraph" : `Heading ${level}`,
  shortcut: `Mod-Alt-${level}`,
  command: setHeading(level),
  active: headingActive(level),
}));

/** The key bindings of every toolbar action. */
export function qmdKeymap(): Record<string, Command> {
  const bindings: Record<string, Command> = {};
  for (const action of Object.values(QMD_ACTIONS)) bindings[action.shortcut] = action.command;
  for (const heading of QMD_HEADINGS) bindings[heading.shortcut] = heading.command;
  return bindings;
}
