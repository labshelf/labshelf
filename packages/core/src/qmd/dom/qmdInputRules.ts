// The input rules of the qmd editor: block shortcuts, Python fences, Markdown marks, and LaTeX delimiters typed in text
// ($…$, \(…\), $$…$$, \[…\]) becoming math nodes stored as $…$ and $$…$$.
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import type { Attrs, MarkType, Node as ProseNode } from "prosemirror-model";
import { NodeSelection, TextSelection, type Command, type EditorState, type Plugin, type Transaction } from "prosemirror-state";
import type { CellLanguage } from "../compute/index.js";
import { qmdSchema } from "../editor/index.js";
import { fenceCellLanguage } from "./inlineViews.js";
import { requestNodeEdit } from "./qmdCommands.js";

const bulletList = qmdSchema.nodes.bullet_list!;
const codeCell = qmdSchema.nodes.code_cell!;
const heading = qmdSchema.nodes.heading!;
const listItem = qmdSchema.nodes.list_item!;
const mathDisplay = qmdSchema.nodes.math_display!;
const mathInline = qmdSchema.nodes.math_inline!;
const orderedList = qmdSchema.nodes.ordered_list!;
const paragraph = qmdSchema.nodes.paragraph!;
const taskItem = qmdSchema.nodes.task_item!;

/** Replaces the paragraph holding `start` by `node` when the matched text is all it holds, selects the node and opens its source editor. */
function replaceWholeParagraph(state: EditorState, start: number, end: number, create: () => ProseNode): Transaction | null {
  const $start = state.doc.resolve(start);
  if ($start.parent.type !== paragraph || $start.parentOffset !== 0 || end - $start.start() !== $start.parent.content.size) return null;
  const pos = $start.before();
  const node = create();
  const tr = state.tr.replaceWith(pos, $start.after(), node);
  // Leaves a line to keep writing on after a block that ends the document.
  if (!tr.doc.resolve(pos + node.nodeSize).nodeAfter) tr.insert(pos + node.nodeSize, paragraph.create());
  return requestNodeEdit(tr.setSelection(NodeSelection.create(tr.doc, pos)), pos);
}

/** `$tex$` becomes inline math. */
const dollarInlineRule = new InputRule(/(?:^|[^$\\])\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, match, start, end) => {
  const lead = match[0].startsWith("$") ? 0 : 1;
  return state.tr.replaceWith(start + lead, end, mathInline.create({ tex: match[1] }));
}, { inCodeMark: false });

/** `\(tex\)` becomes inline math; TeX holding a dollar is left as text, since it could not be stored between dollars. */
const parenInlineRule = new InputRule(/(^|[^\\])\\\(((?:[^\\]|\\(?![()]))+)\\\)$/, (state, match, start, end) => {
  const tex = (match[2] as string).trim();
  if (!tex || tex.includes("$")) return null;
  return state.tr.replaceWith(start + (match[1] as string).length, end, mathInline.create({ tex }));
}, { inCodeMark: false });

/**
 * Makes display math of `tex` from the text between `start` and `end`, splitting the paragraph when text is around it.
 * The caret goes to the start of the paragraph after the equation, which holds the text that followed the delimiters.
 */
function displayFromText(state: EditorState, start: number, end: number, tex: string): Transaction | null {
  const $start = state.doc.resolve(start);
  if ($start.parent.type !== paragraph || !tex || tex.includes("$")) return null;
  const node = mathDisplay.create({ tex });
  const tr = state.tr.delete(start, end);
  let at = $start.before();
  if ($start.parentOffset > 0) {
    tr.split(start);
    at = start + 1;
  }
  const $at = tr.doc.resolve(at);
  if (!$at.parent.canReplaceWith($at.index(), $at.index(), mathDisplay)) return null;
  tr.insert(at, node);
  return tr.setSelection(TextSelection.create(tr.doc, at + node.nodeSize + 1)).scrollIntoView();
}

/** `$$tex$$` and `\[tex\]` typed in text become display math. */
const dollarDisplayRule = new InputRule(/\$\$([^$]+)\$\$$/, (state, match, start, end) => displayFromText(state, start, end, (match[1] as string).trim()), { inCodeMark: false });
const bracketDisplayRule = new InputRule(/(^|[^\\])\\\[((?:[^\\]|\\(?![[\]]))+)\\\]$/, (state, match, start, end) =>
  displayFromText(state, start + (match[1] as string).length, end, (match[2] as string).trim()), { inCodeMark: false });

/** `$$` or `\[` on an empty line opens an empty display equation. */
const emptyDisplayRule = new InputRule(/^(?:\$\$|\\\[)$/, (state, _match, start, end) => replaceWholeParagraph(state, start, end, () => mathDisplay.create()));

/** The math input rules, the display ones first so `$$tex$$` is not read as inline math. */
function mathInputRules(): InputRule[] {
  return [emptyDisplayRule, dollarDisplayRule, bracketDisplayRule, dollarInlineRule, parenInlineRule];
}

/** `[ ] ` or `[x] ` at the start of a paragraph makes a task item, turning a fresh bullet item into one in place. */
const taskRule = new InputRule(/^\[( |x|X)\]\s$/, (state, match, start, end) => {
  const checked = match[1] !== " ";
  const attrs = { checked, mark: checked ? (match[1] as string) : "x" };
  const $start = state.doc.resolve(start);
  if ($start.parent.type !== paragraph) return null;
  const tr = state.tr.delete(start, end);
  if ($start.depth >= 2 && $start.node(-1).type === listItem && $start.index(-1) === 0 && $start.node(-2).type === bulletList) {
    return tr.setNodeMarkup($start.before(-1), taskItem, attrs);
  }
  const range = tr.doc.resolve(start).blockRange();
  if (!range) return null;
  try {
    return tr.wrap(range, [{ type: bulletList }, { type: taskItem, attrs }]);
  } catch {
    return null;
  }
});

/** A fence opener: three backticks, optionally followed by a language word, bare or in braces, such as `{python}`, `r` or `{mathematica}`. */
const CODE_FENCE = /^```(?:\{(\w+)\}|(\w+))?$/;

/** The cell language a typed fence opener names: Python for bare backticks or `py`, undefined for a word that is not a cell language. */
function fenceLanguage(match: RegExpExecArray | RegExpMatchArray | null): CellLanguage | undefined {
  if (!match) return undefined;
  return fenceCellLanguage(match[1] ?? match[2] ?? null);
}

/** A cell-language fence opener followed by a space becomes a code cell of that language. */
const codeCellRule = new InputRule(/^```(?:\{(\w+)\}|(\w+))?\s$/, (state, match, start, end) => {
  const lang = fenceLanguage(match);
  return lang ? replaceWholeParagraph(state, start, end, () => codeCell.create({ lang })) : null;
});

/** Enter at the end of a line holding only a cell-language fence opener makes a code cell, as the space does. */
export const codeFenceEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== paragraph || $from.parentOffset !== $from.parent.content.size) return false;
  const lang = fenceLanguage(CODE_FENCE.exec($from.parent.textContent));
  if (!lang) return false;
  const tr = replaceWholeParagraph(state, $from.start(), $from.pos, () => codeCell.create({ lang }));
  if (!tr) return false;
  dispatch?.(tr.scrollIntoView());
  return true;
};

/**
 * Wraps the text between Markdown delimiters in `type` while typing, as `**bold**`, `_italic_` or `` `code` `` do.
 * The pattern's first group is the character before the opening delimiter, its second the wrapped text.
 */
function markRule(pattern: RegExp, delimiter: string, type: MarkType, attrs: Attrs | null): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const text = match[2] as string;
    const from = start + (match[1] as string).length;
    const textStart = from + delimiter.length;
    const textEnd = textStart + text.length;
    if (state.doc.rangeHasMark(textStart, textEnd, qmdSchema.marks.code!)) return null;
    const tr = state.tr.delete(textEnd, end).delete(from, textStart);
    tr.addMark(from, from + text.length, type.create(attrs)).removeStoredMark(type);
    return tr;
  }, { inCodeMark: false });
}

const strong = qmdSchema.marks.strong!;
const em = qmdSchema.marks.em!;
const code = qmdSchema.marks.code!;
const markRules = [
  markRule(/(^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "**", strong, { marker: "*" }),
  markRule(/(^|[^_\w])__([^_\s](?:[^_]*[^_\s])?)__$/, "__", strong, { marker: "_" }),
  markRule(/(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "*", em, { marker: "*" }),
  markRule(/(^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, "_", em, { marker: "_" }),
  markRule(/(^|[^`])`([^`]+)`$/, "`", code, { ticks: 1 }),
];

/** The input rules plugin of the qmd editor: block shortcuts, math, code cell fences and Markdown marks while typing. */
export function qmdInputRules(): Plugin {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, heading, (match) => ({ level: (match[1] as string).length })),
      taskRule,
      wrappingInputRule(/^\s*([-+*])\s$/, bulletList, (match) => ({ marker: match[1] })),
      wrappingInputRule(
        /^(\d+)([.)])\s$/,
        orderedList,
        (match) => ({ order: Number(match[1]), delimiter: match[2] }),
        (match, node) => node.childCount + (node.attrs.order as number) === Number(match[1]),
      ),
      ...mathInputRules(),
      codeCellRule,
      ...markRules,
    ],
  });
}
