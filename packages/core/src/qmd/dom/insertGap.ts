// The insert points of an editable note (plan notebook-flow D13): a '+' in each gap between top-level blocks and, on an empty note, a row of block choices.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { renderElement, showMenu } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { toCellLanguage } from "../compute/index.js";
import { qmdSchema } from "../editor/index.js";
import { blockChoiceItems } from "./qmdControls.js";

const { code_cell: codeCell, output: outputNode, paragraph } = qmdSchema.nodes;

/** Whether `doc` is an empty note: one empty paragraph (the placeholder's test). */
export function isEmptyNote(doc: ProseNode): boolean {
  const first = doc.firstChild;
  return doc.childCount === 1 && first !== null && first.type === paragraph && first.content.size === 0;
}

/** The language of the nearest code cell before `pos`, else of the nearest one after it, else 'python'. */
export function noteLanguageAt(doc: import("prosemirror-model").Node, pos: number): string {
  let before: string | undefined;
  let after: string | undefined;
  doc.descendants((node, at) => {
    if (node.type !== codeCell) return true;
    const lang = String(node.attrs.lang ?? "");
    if (at < pos) before = lang;
    else after ??= lang;
    return false;
  });
  return before ?? after ?? "python";
}

/** Keeps ProseMirror out of the events of a widget's own buttons. */
const WIDGET = { stopEvent: () => true, ignoreSelection: true } as const;

/**
 * Opens the insert menu (the chosen language's cell, Equation, Drawing, Text, then the other languages) under `anchor` for the gap at `gapPos()`:
 * a choice first selects the block before the gap, so it lands right after that block. Shared by the gap '+' and the line gutter's '+'.
 */
export function showGapMenu(view: EditorView, anchor: HTMLElement, gapPos: () => number | undefined): void {
  const pos = gapPos();
  if (pos === undefined) return;
  const language = toCellLanguage(noteLanguageAt(view.state.doc, pos)) ?? "python";
  const place = (): void => {
    const gap = gapPos();
    const before = gap === undefined ? null : view.state.doc.resolve(gap).nodeBefore;
    if (gap !== undefined && before) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, gap - before.nodeSize)));
  };
  const { main, others } = blockChoiceItems(view, language, place);
  showMenu(anchor, [...main, "separator", ...others]);
}

/** The '+' of the gap at `getPos()`: its menu inserts the chosen block there, after selecting the block before the gap. */
function renderGap(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const button = renderElement("button", { class: "qmd-insert-gap", type: "button", "aria-haspopup": "menu", "aria-label": "Insert here", title: "Insert here", contenteditable: "false", html: renderIcon("plus") });
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => showGapMenu(view, button, getPos));
  return button;
}

/** The row of choices of an empty note; each replaces the empty paragraph, and Text puts the caret into it. */
function renderEmptyChoices(view: EditorView): HTMLElement {
  const place = (): void => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))); };
  const { main } = blockChoiceItems(view, toCellLanguage(noteLanguageAt(view.state.doc, 0)) ?? "python", place);
  const buttons = main.map((item) => {
    const button = renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", text: item.label });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => item.onSelect());
    return button;
  });
  return renderElement("div", { class: "qmd-empty-choices", role: "group", "aria-label": "Start with", contenteditable: "false" }, ...buttons);
}

function decorate(doc: ProseNode): DecorationSet {
  if (isEmptyNote(doc)) return DecorationSet.create(doc, [Decoration.widget(doc.content.size, renderEmptyChoices, { ...WIDGET, side: 1, key: "qmd-empty-choices" })]);
  const widgets: Decoration[] = [];
  doc.forEach((node, offset, index) => {
    // A cell's outputs stay with it: no gap between them.
    if (index === 0 || node.type === outputNode) return;
    widgets.push(Decoration.widget(offset, renderGap, { ...WIDGET, side: -1, key: "qmd-insert-gap" }));
  });
  return DecorationSet.create(doc, widgets);
}

/** Draws the gap '+' buttons and the empty note's choices; mount it on editable views only. */
export function insertGapPlugin(): import("prosemirror-state").Plugin {
  return new Plugin<DecorationSet>({
    state: { init: (_config, state) => decorate(state.doc), apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set) },
    props: { decorations(state) { return this.getState(state); } },
  });
}
