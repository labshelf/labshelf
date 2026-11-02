// Shows typeset inline and display equations; editing shows the LaTeX in place between its visible dollar signs, and
// typing or deleting a dollar sign there turns one kind into the other.
import { Fragment, type Node as ProseNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { Decoration, EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { attachEnvironmentHelp, emptyEnvironmentCaret } from "./mathEnvironments.js";
import { parseMathSvg } from "./drawingEditor/index.js";
import { editNodeAt, exitNode, registerNodeEditor, setViewNodeAttribute, type EditSide } from "./inlineViews.js";
import { attachMathHoverCard, renderCardAction, type MathHoverCard } from "./mathHoverCard.js";
import { stepChecksOf } from "./mathCheckPlugin.js";
import { attachMathStepMarks, type MathStepMarks } from "./mathStepMarks.js";

/** @public The seam labelField.test.ts reads by name through `import * as mathView`. */
export { parseMathSvg };

export type MathLoader = () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>;

/** What an inline math computes when the editor has a runner (built by `createMathComputeHooks`). */
export interface MathComputeHooks {
  /** The math at `getPos()` was left: a math ending with `=` or `\approx` asks for its result. */
  leave(view: EditorView, getPos: () => number | undefined): void;
  /** Whether the math at `getPos()` is an equation Solve can answer now. */
  canSolve(view: EditorView, getPos: () => number | undefined): boolean;
  solve(view: EditorView, getPos: () => number | undefined, onFail: (message: string) => void): void;
}

/**
 * Loads the `@labshelf/core/math` entry. Inside core that specifier does not resolve, so the entry is named by its path.
 * TRAP: it is about 2.5 MB of CommonJS with import-time side effects; only ever import it lazily, never statically.
 */
export const loadCoreMath: MathLoader = () => import("../../latex/hover/index.js");

/**
 * Renders `tex` into `target`: the TeX in `.qmd-math-source` while MathJax loads, then the SVG. A parse error shows the
 * TeX as `.qmd-math-error` with the message in `title`, and for display math also as visible text under it.
 * @returns the parser's message, or null once the TeX rendered.
 */
export async function renderMathInto(target: HTMLElement, tex: string, display: boolean, loadMath: MathLoader): Promise<string | null> {
  target.replaceChildren(renderElement("code", { class: "qmd-math-source", text: tex }));
  try {
    const math = await loadMath();
    target.replaceChildren(parseMathSvg(math.renderMathSvg(tex, display)));
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const source = renderElement("code", { class: "qmd-math-error", title: message, text: tex });
    target.replaceChildren(display ? renderElement("span", { class: "qmd-math-error-block" }, source, renderElement("span", { class: "qmd-math-error-message", text: message })) : source);
    return message;
  }
}

const PLACEHOLDER = { display: "Empty equation — click to write LaTeX", inline: "LaTeX" };

/**
 * Shows an equation typeset. Clicking it, Enter on it or creating it empty shows its LaTeX in place between `$$` (or `$`)
 * in the text's flow, without a box, in place of the typeset form; leaving the LaTeX typesets it again.
 * `$` typed against an inline equation's dollar sign makes it a display one; Backspace at the start of a display
 * equation's LaTeX makes it inline.
 */
class MathView implements NodeView {
  readonly dom: HTMLElement;
  private readonly rendered: HTMLElement;
  private editor: HTMLInputElement | HTMLTextAreaElement | null = null;
  private sourcePanel: HTMLElement | null = null;
  private errorText: HTMLElement | null = null;
  private error: string | null = null;
  private originalTex = "";
  private token = 0;
  private readonly card: MathHoverCard | null = null;
  private solveFailure = "";
  /** The step marks the check plugin's decorations carry (D9), drawn after the math or in a gutter per aligned line. */
  private readonly marks: MathStepMarks;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly display: boolean, private readonly loadMath: MathLoader, decorations: readonly Decoration[], private readonly compute?: MathComputeHooks) {
    this.dom = renderElement(display ? "div" : "span", { class: display ? "qmd-math qmd-math-display" : "qmd-math qmd-math-inline", title: view.editable ? "Click to edit equation" : "" });
    this.rendered = renderElement(display ? "div" : "span", { class: "qmd-math-rendered" });
    this.dom.append(this.rendered);
    this.dom.addEventListener("click", (event) => {
      if (view.editable && event.target instanceof Node && this.rendered.contains(event.target)) this.editSource();
    });
    registerNodeEditor(this.dom, (side) => this.editSource(side));
    if (compute && !display) this.card = attachMathHoverCard(this.dom, "Equation", () => this.cardContent());
    this.marks = attachMathStepMarks(this.dom, this.rendered, display, () => this.card?.hide());
    this.marks.update(stepChecksOf(decorations));
    this.render();
  }

  /** The Solve card of an equation not yet solved, while its LaTeX is not being edited and no step mark has focus. */
  private cardContent(): HTMLElement[] | null {
    if (this.editor || this.marks.contains(this.dom.ownerDocument.activeElement) || !this.compute?.canSolve(this.view, this.getPos)) return null;
    const content: HTMLElement[] = [renderCardAction("Solve", () => {
      this.solveFailure = "";
      this.card?.hide();
      this.compute?.solve(this.view, this.getPos, (message) => { this.solveFailure = message; this.card?.show(); });
    })];
    if (this.solveFailure) content.push(renderElement("span", { class: "qmd-math-card-text qmd-math-card-warning", role: "alert", text: this.solveFailure }));
    return content;
  }

  private get tex(): string {
    return this.node.attrs.tex as string;
  }

  private render(): void {
    const token = ++this.token;
    const kind = this.display ? "display" : "inline";
    this.dom.classList.toggle("qmd-math-empty", !this.tex.trim());
    if (!this.tex.trim()) {
      this.error = null;
      this.showError();
      this.rendered.replaceChildren(renderElement("span", { class: "qmd-math-placeholder", text: PLACEHOLDER[kind] }));
      return;
    }
    const target = renderElement(this.display ? "div" : "span", { class: "qmd-math-rendered" });
    if (!this.rendered.querySelector("svg")) this.rendered.replaceChildren(renderElement("code", { class: "qmd-math-source", text: this.tex }));
    void renderMathInto(target, this.tex, this.display, this.loadMath).then((error) => {
      if (token !== this.token) return;
      this.rendered.replaceChildren(...Array.from(target.childNodes));
      this.error = error;
      this.showError();
    });
  }

  /** While editing, the parse error shows as text under a display equation's LaTeX and as the inline LaTeX's tooltip. */
  private showError(): void {
    if (!this.errorText) return;
    this.sourcePanel?.classList.toggle("qmd-math-invalid", this.error !== null);
    if (this.editor) this.editor.title = this.error ?? "";
    this.errorText.textContent = this.error ?? "";
    this.errorText.hidden = this.error === null;
  }

  update(node: ProseNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.tex !== this.node.attrs.tex;
    this.node = node;
    if (changed) { this.solveFailure = ""; this.render(); }
    this.marks.update(stepChecksOf(decorations));
    this.card?.refresh();
    if (this.editor && this.editor.value !== this.tex && document.activeElement !== this.editor) this.editor.value = this.tex;
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
    queueMicrotask(() => { if (this.dom.classList.contains("ProseMirror-selectednode")) this.card?.show(); });
  }

  /** Shows the LaTeX in place with the caret at its `side`: the end when clicked, the side the caret came from when arrowed into. */
  private editSource(side: EditSide = "end"): void {
    if (!this.view.editable) return;
    if (this.editor) { this.editor.focus(); return; }
    const pos = this.getPos();
    if (pos === undefined) return;
    if (!(this.view.state.selection instanceof NodeSelection && this.view.state.selection.from === pos)) {
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    }
    this.dom.classList.add("qmd-math-editing");
    this.card?.hide();
    const { input, suggestions } = this.createSourceInput();
    // Clicking anywhere else keeps the edit and hides the LaTeX.
    input.addEventListener("focusout", (raw) => {
      const next = (raw as FocusEvent).relatedTarget;
      if (!(next instanceof Node && this.sourcePanel?.contains(next))) this.leave();
    });
    this.editor = input;
    this.errorText = renderElement("span", { class: "qmd-math-edit-error", role: "alert", hidden: true });
    const dollars = this.display ? "$$" : "$";
    const delimiter = (): HTMLElement => renderElement("span", { class: "qmd-math-delimiter", "aria-hidden": "true", text: dollars });
    this.sourcePanel = renderElement("span", { class: "qmd-math-edit", contenteditable: "false" }, delimiter(), input, delimiter(), suggestions, this.errorText);
    this.showError();
    this.dom.prepend(this.sourcePanel);
    queueMicrotask(() => {
      if (this.editor !== input) return;
      input.focus();
      const at = emptyEnvironmentCaret(input.value) ?? (side === "start" ? 0 : input.value.length);
      input.setSelectionRange(at, at);
    });
  }

  /** The field of the LaTeX with its environment help: a textarea for display math, a line input for inline math, sized to its text as it changes. */
  private createSourceInput(): { input: HTMLInputElement | HTMLTextAreaElement; suggestions: ReturnType<typeof attachEnvironmentHelp> } {
    const input = this.display
      ? renderElement("textarea", { rows: 1, class: "qmd-math-input", spellcheck: "false", "aria-label": "TeX source", placeholder: "\\frac{a}{b}" })
      : renderElement("input", { class: "qmd-math-input", type: "text", spellcheck: "false", "aria-label": "TeX source", placeholder: "LaTeX" });
    this.originalTex = this.tex;
    input.value = this.tex;
    const fit = (): void => {
      if (input instanceof HTMLTextAreaElement) input.rows = Math.max(1, input.value.split("\n").length);
      else input.style.width = `${Math.max(input.value.length, input.placeholder.length) + 1}ch`;
    };
    fit();
    const suggestions = attachEnvironmentHelp(input);
    input.addEventListener("input", () => { fit(); this.commit(input.value); });
    input.addEventListener("keydown", (raw) => this.onSourceKey(input, raw as KeyboardEvent));
    return { input, suggestions };
  }

  private onSourceKey(input: HTMLInputElement | HTMLTextAreaElement, event: KeyboardEvent): void {
    if (event.isComposing) return;
    const dir = this.leaveDirection(input, event);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.finish(true); }
    else if (event.key === "Enter" && this.endsOnEnter(input, event)) { event.preventDefault(); this.commit(input.value.replace(/\n$/, "")); this.finish(false); }
    else if (dir !== 0) { event.preventDefault(); this.finish(false, dir); }
    else if (event.key === "Backspace" && input.value === "") { event.preventDefault(); this.finish(false); }
    else if (this.convertsOn(input, event)) { event.preventDefault(); this.convert(); }
  }

  /** Where an arrow key leaves the field: -1 before the equation, 1 after it, 0 when it moves inside the TeX. */
  private leaveDirection(input: HTMLInputElement | HTMLTextAreaElement, event: KeyboardEvent): -1 | 0 | 1 {
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || input.selectionStart !== input.selectionEnd) return 0;
    const at = input.selectionStart ?? 0;
    const value = input.value;
    if (event.key === "ArrowLeft" && at === 0) return -1;
    if (event.key === "ArrowRight" && at === value.length) return 1;
    if (!this.display) return 0;
    if (event.key === "ArrowUp" && !value.slice(0, at).includes("\n")) return -1;
    if (event.key === "ArrowDown" && !value.slice(at).includes("\n")) return 1;
    return 0;
  }

  /**
   * Whether Enter leaves the LaTeX: always inline; in a display equation only on an empty last line (Enter twice at the
   * end) or in an empty equation, any other Enter (or Shift-Enter) adding a line.
   */
  private endsOnEnter(input: HTMLInputElement | HTMLTextAreaElement, event: KeyboardEvent): boolean {
    if (!this.display) return true;
    if (event.shiftKey || input.selectionStart !== input.selectionEnd || input.selectionStart !== input.value.length) return false;
    return input.value === "" || input.value.endsWith("\n");
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
    this.card?.hide();
    this.leave();
  }

  /** Whether the key adds or deletes a dollar sign at the LaTeX's edge: `$` at either edge of inline math, Backspace at the start of display math. */
  private convertsOn(input: HTMLInputElement | HTMLTextAreaElement, event: KeyboardEvent): boolean {
    if (event.altKey || event.metaKey || event.ctrlKey || input.selectionStart !== input.selectionEnd) return false;
    const at = input.selectionStart ?? 0;
    if (!this.display) return event.key === "$" && (at === 0 || at === input.value.length);
    return event.key === "Backspace" && at === 0;
  }

  /**
   * Turns inline math into display math, splitting its paragraph around it, or display math into inline math in a
   * paragraph of its own, and opens the new equation's LaTeX. A labelled display equation, or one whose place does
   * not take the other kind, stays as it is.
   */
  private convert(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { schema, doc } = this.view.state;
    const paragraph = schema.nodes.paragraph!;
    let from: number, to: number, nodes: ProseNode[], editAt: number;
    if (this.display) {
      if (this.node.attrs.label) return;
      const inline = schema.nodes.math_inline!.create({ tex: this.tex.replace(/\s*\n\s*/g, " ").trim() });
      [from, to, nodes, editAt] = [pos, pos + this.node.nodeSize, [paragraph.create(null, inline)], pos + 1];
    } else {
      const $pos = doc.resolve(pos);
      const offset = pos - $pos.start();
      const before = $pos.parent.content.cut(0, offset), after = $pos.parent.content.cut(offset + this.node.nodeSize);
      const display = schema.nodes.math_display!.create({ tex: this.tex });
      nodes = [...(before.size ? [paragraph.create(null, before)] : []), display];
      if (after.size || $pos.after() === doc.content.size) nodes.push(paragraph.create(null, after));
      [from, to, editAt] = [$pos.before(), $pos.after(), $pos.before() + (before.size ? nodes[0]!.nodeSize : 0)];
    }
    const $from = doc.resolve(from);
    if (!$from.parent.canReplace($from.index(), $from.index() + 1, Fragment.from(nodes))) return;
    this.close();
    this.view.dispatch(this.view.state.tr.replaceWith(from, to, nodes).scrollIntoView());
    const view = this.view;
    queueMicrotask(() => editNodeAt(view, editAt, this.display ? "start" : "end"));
  }

  /** Hides the LaTeX, keeping what was written. */
  private close(): void {
    this.dom.classList.remove("qmd-math-editing");
    const panel = this.sourcePanel;
    this.sourcePanel = null;
    this.editor = null;
    this.errorText = null;
    panel?.remove();
  }

  /** Hides the LaTeX as the writer leaves it, which asks for the result of a math that ends with `=` or `\approx` (D8). */
  private leave(): void {
    const editing = this.editor !== null;
    this.close();
    if (editing && !this.display) this.compute?.leave(this.view, this.getPos);
  }

  /** Hides the LaTeX and puts the caret after the equation (`dir` -1: before it); `cancel` restores the TeX it had, and an equation left empty is removed. */
  private finish(cancel: boolean, dir: 1 | -1 = 1): void {
    if (cancel) { this.commit(this.originalTex); this.close(); }
    else this.leave();
    const pos = this.getPos();
    if (pos === undefined) return;
    if (!this.tex.trim()) {
      const tr = this.view.state.tr;
      if (this.display) tr.replaceWith(pos, pos + this.node.nodeSize, this.view.state.schema.nodes.paragraph!.create()).setSelection(TextSelection.create(tr.doc, pos + 1));
      else tr.delete(pos, pos + this.node.nodeSize).setSelection(TextSelection.create(tr.doc, pos));
      this.view.dispatch(tr.scrollIntoView());
      this.view.focus();
      return;
    }
    if (this.display) { exitNode(this.view, this.getPos, dir); return; }
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, dir > 0 ? pos + this.node.nodeSize : pos)));
    this.view.focus();
  }

  private commit(tex: string): void {
    if (tex !== this.tex) setViewNodeAttribute(this.view, this.getPos, "tex", tex);
  }

  stopEvent(event: Event): boolean {
    if (this.card?.contains(event.target) || this.marks.contains(event.target)) return true;
    return this.sourcePanel !== null && event.target instanceof Node && this.sourcePanel.contains(event.target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.token++;
    this.card?.destroy();
    this.marks.destroy();
    this.close();
  }
}

/**
 * A node view for `math_inline` (`display` false) or `math_display` (`display` true); `loadMath` defaults to the lazy `@labshelf/core/math`
 * import. `compute`, given with a runner, makes an inline math ask for its result when left and offer Solve on an equation.
 * Either kind draws the step marks that the check plugin (present only with a runner) puts in its decorations.
 */
export function createMathView(display: boolean, loadMath?: MathLoader, compute?: MathComputeHooks): NodeViewConstructor {
  const loader = loadMath ?? loadCoreMath;
  return (node, view, getPos, decorations) => new MathView(node, view, getPos, display, loader, decorations, compute);
}
