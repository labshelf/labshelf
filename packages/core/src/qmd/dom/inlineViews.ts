// Shows the small inline and list parts of an item body: citation chips, task item checkboxes and `labshelf:` links as internal links.
import type { Mark, Node as ProseNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { EditorView, MarkViewConstructor, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement, showMenu } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { CELL_LANGUAGES, cellLanguageLabel, toCellLanguage, type CellLanguage, type CellResult } from "../compute/index.js";

/** A node view for `citation`: its `[@key]` keys as one chip; the keys are not looked up. */
export function createCitationView(): NodeViewConstructor {
  return (node) => {
    const keys = node.attrs.keys as string[];
    const dom = renderElement("span", { class: "qmd-citation", contenteditable: "false", "data-citation": keys.join(" "), text: `[${keys.map((key) => `@${key}`).join("; ")}]` });
    return { dom, ignoreMutation: () => true };
  };
}

class TaskItemView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly box: HTMLInputElement;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined) {
    this.box = renderElement("input", { class: "qmd-task-check", type: "checkbox", "aria-label": "Done" });
    this.box.disabled = !view.editable;
    this.box.addEventListener("mousedown", (event) => event.preventDefault());
    // Not cancelled: a cancelled click restores the box's old state after the transaction has set the new one.
    this.box.addEventListener("click", () => this.toggle());
    this.contentDOM = renderElement("div", { class: "qmd-task-content" });
    this.dom = renderElement("li", { class: "qmd-task" }, renderElement("span", { class: "qmd-task-box", contenteditable: "false" }, this.box), this.contentDOM);
    this.render();
  }

  private render(): void {
    const checked = this.node.attrs.checked === true;
    this.box.checked = checked;
    this.dom.dataset.task = checked ? "done" : "open";
  }

  private toggle(): void {
    if (!this.view.editable || !setViewNodeAttribute(this.view, this.getPos, "checked", this.node.attrs.checked !== true)) this.render();
  }

  stopEvent(event: Event): boolean {
    return event.target === this.box;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }): boolean {
    return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
}

/** A node view for `task_item`: a checkbox that reflects `checked` and toggles it through a transaction. */
export function createTaskItemView(): NodeViewConstructor {
  return (node, view, getPos) => new TaskItemView(node, view, getPos);
}

/** Sets one attribute of a node view's node through a transaction; false when the node has no position. */
export function setViewNodeAttribute(view: EditorView, getPos: () => number | undefined, name: string, value: unknown): boolean {
  const pos = getPos();
  if (pos === undefined) return false;
  view.dispatch(view.state.tr.setNodeAttribute(pos, name, value));
  return true;
}

/** The cell language a fence language word names: Python for a bare fence (null) or `py`, otherwise what `toCellLanguage` says; undefined for a word that is not a cell language. */
export function fenceCellLanguage(word: string | null | undefined): CellLanguage | undefined {
  if (word === null || word === undefined) return "python";
  return word.toLowerCase() === "py" ? "python" : toCellLanguage(word);
}

/** Where the caret lands when a node's own editor opens: at the start of its source or at its end. */
export type EditSide = "start" | "end";

const nodeEditors = new WeakMap<Node, (side: EditSide) => void>();

/** What a code cell view offers the outputs under it: its language, switching and restarting it, running it, and folding its code. */
export interface CellControls {
  /** The name the cell's language is shown by: a cell language's label, or the fence language as written. */
  language(): string;
  /** The cell's language when it is one the editor runs; undefined for any other fence language. */
  cellLanguage(): CellLanguage | undefined;
  /** Rewrites the cell's fence for `language`. */
  setLanguage(language: CellLanguage): void;
  /** Whether the cell can run: the host runs cells and the cell's language is a cell language. */
  canRun(): boolean;
  run(): void;
  /** Whether the host restarts a language's session; Restart shows only then. */
  canRestart(): boolean;
  /** Restarts the session of the cell's language. */
  restart(): void;
  /** Whether the cell has a result, whose outputs then carry the cell's line. */
  hasResult(): boolean;
  /** Whether the cell's code is folded away behind its result. */
  folded(): boolean;
  isOpen(): boolean;
  /** Unfolds the code in place above the outputs, or folds it again. */
  setOpen(open: boolean): void;
  isRunning(): boolean;
  /** The result of the latest param drag preview, which the outputs show in place of the stored one until the release run ends. */
  previewResult(): CellResult | undefined;
  /** Calls `listener` when the open, running, folded or preview state changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Rechecks the cell's outputs after one was added or removed; `now` rechecks at once, while the editor draws its first document. */
  refresh(now?: boolean): void;
}

const cellControls = new WeakMap<Node, CellControls>();

/**
 * The cell's language as a picker button opening a radio menu of the cell languages, or the fence language as plain text
 * when it is not one; the picker is disabled while the note is read-only.
 */
export function renderLanguagePicker(controls: CellControls, className: string, editable: boolean): HTMLElement {
  const current = controls.cellLanguage();
  const name = controls.language();
  if (!current) return renderElement("span", { class: className }, name);
  const picker = renderElement("button", { class: `${className} qmd-cell-lang-picker`, type: "button", "aria-haspopup": "menu", "aria-label": `Language: ${name}`, title: "Change the cell's language", disabled: editable ? undefined : true },
    name, renderElement("span", { class: "qmd-cell-lang-caret", html: renderIcon("chevron-down"), "aria-hidden": "true" }));
  picker.addEventListener("click", () => {
    showMenu(picker, CELL_LANGUAGES.map((language) => ({ label: cellLanguageLabel(language), radio: true, checked: language === controls.cellLanguage(), onSelect: () => controls.setLanguage(language) })));
  });
  return picker;
}

/** Restart <Language>, which drops the session of the cell's language; null when the host restarts nothing or the language is not a cell language. */
export function renderRestartButton(controls: CellControls, className: string): HTMLButtonElement | null {
  const language = controls.cellLanguage();
  if (!controls.canRestart() || !language) return null;
  const label = `Restart ${cellLanguageLabel(language)}`;
  const button = renderElement("button", { class: className, type: "button", "aria-label": label, title: `${label}: earlier definitions are gone` }, "Restart");
  button.addEventListener("click", () => controls.restart());
  return button;
}

/** The controls of the cells drawn while an editor draws its first document, by position: it has no doc view to look them up in yet. */
const drawingCellControls = new WeakMap<EditorView, Map<number, CellControls>>();

/** Lets outputs and navigation reach the code cell view whose outer element is `dom`; `view` and `pos`, when given, let the outputs drawn in the same first draw find the cell before the editor has a doc view. */
export function registerCellControls(dom: HTMLElement, controls: CellControls, view?: EditorView, pos?: number): void {
  cellControls.set(dom, controls);
  if (!view || pos === undefined || !view.isDestroyed) return;
  let drawing = drawingCellControls.get(view);
  if (!drawing) { drawing = new Map(); drawingCellControls.set(view, drawing); }
  drawing.set(pos, controls);
}

/** The controls of the code cell view at `pos`, or null. */
export function cellControlsAt(view: EditorView, pos: number): CellControls | null {
  if (view.isDestroyed) return drawingCellControls.get(view)?.get(pos) ?? null;
  const dom = pos >= 0 && pos < view.state.doc.content.size ? view.nodeDOM(pos) : null;
  return (dom && cellControls.get(dom)) ?? null;
}

/** Lets `editNodeAt` open the editor of the node view whose outer element is `dom`, such as a code cell's code or an equation's LaTeX field. */
export function registerNodeEditor(dom: HTMLElement, edit: (side: EditSide) => void): void {
  nodeEditors.set(dom, edit);
}

/** Opens the editor of the node view at `pos`; false when the node there has none. */
export function editNodeAt(view: EditorView, pos: number, side: EditSide = "start"): boolean {
  if (view.isDestroyed || !view.editable) return false;
  const dom = pos >= 0 && pos < view.state.doc.content.size ? view.nodeDOM(pos) : null;
  const edit = dom ? nodeEditors.get(dom) : undefined;
  if (!edit) return false;
  edit(side);
  return true;
}

/**
 * Moves the editor's caret out of the atom node at `getPos()`: into the textblock right after it (`dir` 1, skipping the
 * outputs that follow a code cell) or right before it (`dir` -1), creating an empty paragraph there when there is none.
 */
export function exitNode(view: EditorView, getPos: () => number | undefined, dir: 1 | -1): boolean {
  const pos = getPos();
  const node = pos === undefined ? null : view.state.doc.nodeAt(pos);
  if (pos === undefined || !node) return false;
  const tr = view.state.tr;
  let target = dir > 0 ? pos + node.nodeSize : pos;
  if (dir > 0) {
    for (let next = tr.doc.resolve(target).nodeAfter; next?.type.name === "output"; next = tr.doc.resolve(target).nodeAfter) target += next.nodeSize;
  }
  const $target = tr.doc.resolve(target);
  const neighbour = dir > 0 ? $target.nodeAfter : $target.nodeBefore;
  let caret: number;
  if (neighbour?.isTextblock) {
    caret = dir > 0 ? target + 1 : target - 1;
  } else {
    const paragraph = view.state.schema.nodes.paragraph!;
    if (!$target.parent.canReplaceWith($target.index(), $target.index(), paragraph)) return false;
    tr.insert(target, paragraph.create());
    caret = target + 1;
  }
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView());
  view.focus();
  return true;
}

const INTERNAL_LINK = /^labshelf:/i;

/** A mark view for `link`: a `labshelf:` href shows as an internal link with the link icon; clicks are opened by the editor's link handler. */
export function createLinkView(): MarkViewConstructor {
  return (mark: Mark) => {
    const href = mark.attrs.href as string;
    const dom = renderElement("a", { href, class: INTERNAL_LINK.test(href) ? "qmd-link qmd-link-internal" : "qmd-link" });
    if (!INTERNAL_LINK.test(href)) return { dom };
    const contentDOM = renderElement("span", { class: "qmd-link-text" });
    dom.append(renderElement("span", { class: "qmd-link-icon", contenteditable: "false", html: renderIcon("link") }), contentDOM);
    return { dom, contentDOM, ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target) };
  };
}
