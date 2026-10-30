// Holds the editing commands of the rich Markdown editor, shared by its keymap, its selection bubble and its Insert menu: marks, headings, lists, math, code cells and links.
import { setBlockType, toggleMark } from "prosemirror-commands";
import type { Mark, MarkType, Node as ProseNode } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { IconName } from "../../ui/icons/index.js";
import { askInputBox, type InputBoxOptions } from "../../ui/dom/index.js";
import type { CellLanguage } from "../compute/index.js";
import { qmdSchema } from "../editor/index.js";
import { editNodeAt, type EditSide } from "./inlineViews.js";
import { listActive, toggleList } from "./qmdListCommands.js";

const nodes = {
  paragraph: qmdSchema.nodes.paragraph!,
  heading: qmdSchema.nodes.heading!,
  math_inline: qmdSchema.nodes.math_inline!,
  math_display: qmdSchema.nodes.math_display!,
  code_cell: qmdSchema.nodes.code_cell!,
};
const marks = { strong: qmdSchema.marks.strong!, em: qmdSchema.marks.em!, code: qmdSchema.marks.code!, link: qmdSchema.marks.link! };

interface EditRequest { pos: number; side: EditSide }
const editRequestKey = new PluginKey<EditRequest | null>("qmdEditRequest");

/** Asks the editor to open the source editor of the node at `pos` (an equation's LaTeX, a cell's code) once `tr` is applied. */
export function requestNodeEdit(tr: Transaction, pos: number, side: EditSide = "start"): Transaction {
  return tr.setMeta(editRequestKey, { pos, side });
}

/** Opens the node editors that transactions ask for through `requestNodeEdit`, after the transaction's own focus handling. */
export function editRequestPlugin(): Plugin {
  return new Plugin<EditRequest | null>({
    key: editRequestKey,
    state: { init: () => null, apply: (tr) => (tr.getMeta(editRequestKey) as EditRequest | undefined) ?? null },
    view: () => ({
      update(view, prev) {
        const request = editRequestKey.getState(view.state);
        if (!request || request === editRequestKey.getState(prev)) return;
        queueMicrotask(() => editNodeAt(view, request.pos, request.side));
      },
    }),
  });
}

/** Enter on a selected equation or code cell opens its source editor. */
const editSelectedNode: Command = (state, _dispatch, view) => {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection) || ![nodes.math_inline, nodes.math_display, nodes.code_cell].includes(selection.node.type)) return false;
  return view ? editNodeAt(view, selection.from) : true;
};

/** Backspace at the very start of a heading turns it back into a paragraph. */
export const headingToParagraph: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== nodes.heading || $from.parentOffset !== 0) return false;
  return setBlockType(nodes.paragraph)(state, dispatch);
};

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
  // An empty equation has nothing to show, so its LaTeX field opens at once.
  if (!tex) requestNodeEdit(tr, selection.from);
  dispatch(tr.scrollIntoView());
  return true;
};

const inlineMathActive = (state: EditorState): boolean => state.selection instanceof NodeSelection && state.selection.node.type === nodes.math_inline;

/** Inserts a block made by `create`, in place of an empty paragraph or after the current block, and opens its source editor. */
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
    dispatch(requestNodeEdit(tr, from).scrollIntoView());
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

/** Inserts an empty code cell of `language` at the caret. */
export function insertCodeCell(language: CellLanguage): Command {
  return insertBlock(() => nodes.code_cell.create({ lang: language }));
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
  codeCell: { id: "codeCell", label: "Code cell", icon: "code", shortcut: "Mod-Alt-c", command: insertCodeCell("python") },
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
  bindings["Mod-e"] = toggleMark(marks.code);
  bindings.Backspace = headingToParagraph;
  bindings.Enter = editSelectedNode;
  return bindings;
}
