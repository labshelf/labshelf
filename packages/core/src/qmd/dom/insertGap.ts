// The insert points of an editable note (plan notebook-flow D13): a '+' at the end of each top-level block (a cell's after its outputs), shown on hover
// between two short lines, and, on an empty note, a row of block choices.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { renderElement, showSectionPanel, type MenuAnchor } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { toCellLanguage } from "../compute/index.js";
import { qmdSchema } from "../editor/index.js";
import { blockChoiceItems, insertPanel } from "./qmdControls.js";

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
 * a choice first selects the block before the gap, so it lands right after that block.
 */
function showGapMenu(view: EditorView, anchor: HTMLElement, gapPos: () => number | undefined, fromPaper: (() => void) | undefined): void {
  const pos = gapPos();
  if (pos === undefined) return;
  const language = toCellLanguage(noteLanguageAt(view.state.doc, pos)) ?? "python";
  const place = (): void => {
    const gap = gapPos();
    const before = gap === undefined ? null : view.state.doc.resolve(gap).nodeBefore;
    if (gap !== undefined && before) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, gap - before.nodeSize)));
  };
  showSectionPanel(anchor, insertPanel(view, { language, place, ...(fromPaper ? { fromPaper } : {}) }));
}

/** Opens the Insert panel at `anchor` (the round '+' or a point), inserting at the caret; `source` adds Edit Markdown source, `fromPaper` From paper…. */
export function showInsertMenu(view: EditorView, anchor: HTMLElement | MenuAnchor, source?: () => void, fromPaper?: () => void): void {
  const language = toCellLanguage(noteLanguageAt(view.state.doc, view.state.selection.from)) ?? "python";
  showSectionPanel(anchor, insertPanel(view, { language, ...(source ? { source } : {}), ...(fromPaper ? { fromPaper } : {}) }));
}

/** The round '+' under the text of an editor without a line gutter: it opens the Insert panel at the caret. */
export function renderInsertButton(view: EditorView, source?: () => void, fromPaper?: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: "qmd-editor-insert", type: "button", "aria-haspopup": "dialog", "aria-label": "Insert", title: "Insert", html: renderIcon("plus") });
  // Keeps the caret where it was, so the panel inserts there.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => showInsertMenu(view, button, source, fromPaper));
  return button;
}

/** The gap at `getPos()`: a strip as wide as the text, with the '+' between its two lines; its menu, under the '+', inserts the chosen block there. */
function renderGap(view: EditorView, getPos: () => number | undefined, fromPaper: (() => void) | undefined): HTMLElement {
  const plus = renderElement("span", { class: "qmd-insert-gap-plus", html: renderIcon("plus") });
  const button = renderElement("button", { class: "qmd-insert-gap", type: "button", "aria-haspopup": "menu", "aria-label": "Insert here", title: "Insert here", contenteditable: "false" }, plus);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => showGapMenu(view, plus, getPos, fromPaper));
  return button;
}

/** The row of choices of an empty note; each replaces the empty paragraph, and Text puts the caret into it. */
function renderEmptyChoices(view: EditorView): HTMLElement {
  const place = (): void => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))); };
  const main = blockChoiceItems(view, toCellLanguage(noteLanguageAt(view.state.doc, 0)) ?? "python", place);
  const buttons = main.map((item) => {
    const button = renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", text: item.label });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => item.onSelect());
    return button;
  });
  return renderElement("div", { class: "qmd-empty-choices", role: "group", "aria-label": "Start with", contenteditable: "false" }, ...buttons);
}

function decorate(doc: ProseNode, emptyChoices: boolean, fromPaper: ((view: EditorView) => void) | undefined): DecorationSet {
  if (emptyChoices && isEmptyNote(doc)) return DecorationSet.create(doc, [Decoration.widget(doc.content.size, renderEmptyChoices, { ...WIDGET, side: 1, key: "qmd-empty-choices" })]);
  const widgets: Decoration[] = [];
  const gap = (pos: number): Decoration => Decoration.widget(pos, (view, getPos) => renderGap(view, getPos, fromPaper && (() => fromPaper(view))), { ...WIDGET, side: -1, key: "qmd-insert-gap" });
  doc.forEach((node, offset, index) => {
    // A cell's outputs stay with it: no gap between them.
    if (index > 0 && node.type !== outputNode) widgets.push(gap(offset));
  });
  widgets.push(gap(doc.content.size));
  return DecorationSet.create(doc, widgets);
}

/**
 * Draws the gap '+' after every block and the empty note's choices (without `emptyChoices`, an empty note gets the gap '+' too); mount it on editable views only.
 * `fromPaper` adds From paper… to the gap menus, opening the picker for the view.
 */
export function insertGapPlugin(emptyChoices = true, fromPaper?: (view: EditorView) => void): import("prosemirror-state").Plugin {
  return new Plugin<DecorationSet>({
    state: { init: (_config, state) => decorate(state.doc, emptyChoices, fromPaper), apply: (tr, set) => (tr.docChanged ? decorate(tr.doc, emptyChoices, fromPaper) : set) },
    props: { decorations(state) { return this.getState(state); } },
  });
}
