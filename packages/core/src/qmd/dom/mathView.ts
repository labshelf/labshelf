// Shows typeset inline and display equations; editing shows the LaTeX in place between its visible dollar signs, and
// typing or deleting a dollar sign there turns one kind into the other.
import { Fragment, type Node as ProseNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { attachEnvironmentHelp, emptyEnvironmentCaret } from "./mathEnvironments.js";
import { editNodeAt, exitNode, registerNodeEditor, setViewNodeAttribute, type EditSide } from "./inlineViews.js";

export type MathLoader = () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>;

/**
 * Loads the `@labshelf/core/math` entry. Inside core that specifier does not resolve, so the entry is named by its path.
 * TRAP: it is about 2.5 MB of CommonJS with import-time side effects; only ever import it lazily, never statically.
 */
export const loadCoreMath: MathLoader = () => import("../../latex/hover/index.js");

const VALIGN_PROPERTY = "--qmd-math-valign";

/**
 * Turns MathJax SVG markup into an element without any `style` attribute.
 * PLATFORM: the webview CSP forbids markup `style=`, so the markup is parsed in an inert document, every `style`
 * attribute is dropped, and the root's `vertical-align` moves to the `--qmd-math-valign` custom property, set through
 * CSSOM (allowed under that CSP); the stylesheet applies it as `vertical-align: var(--qmd-math-valign)`.
 */
function parseMathSvg(markup: string): Element {
  const parsed = new DOMParser().parseFromString(markup, "text/html").querySelector("svg");
  if (!parsed) throw new Error("MathJax returned no SVG");
  const valign = /vertical-align:\s*([^;]+)/.exec(parsed.getAttribute("style") ?? "")?.[1]?.trim();
  for (const node of [parsed, ...Array.from(parsed.querySelectorAll("[style]"))]) node.removeAttribute("style");
  const svg = document.importNode(parsed, true);
  if (valign) svg.style.setProperty(VALIGN_PROPERTY, valign);
  return svg;
}

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

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly display: boolean, private readonly loadMath: MathLoader) {
    this.dom = renderElement(display ? "div" : "span", { class: display ? "qmd-math qmd-math-display" : "qmd-math qmd-math-inline", title: view.editable ? "Click to edit equation" : "" });
    this.rendered = renderElement(display ? "div" : "span", { class: "qmd-math-rendered" });
    this.dom.append(this.rendered);
    this.dom.addEventListener("click", (event) => {
      if (view.editable && event.target instanceof Node && this.rendered.contains(event.target)) this.editSource();
    });
    registerNodeEditor(this.dom, (side) => this.editSource(side));
    this.render();
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

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.tex !== this.node.attrs.tex;
    this.node = node;
    if (changed) this.render();
    if (this.editor && this.editor.value !== this.tex && document.activeElement !== this.editor) this.editor.value = this.tex;
    return true;
  }

  selectNode(): void { this.dom.classList.add("ProseMirror-selectednode"); }

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
    input.addEventListener("keydown", (raw) => {
      const event = raw as KeyboardEvent;
      if (event.isComposing) return;
      const dir = this.leaveDirection(input, event);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.finish(true); }
      else if (event.key === "Enter" && this.endsOnEnter(input, event)) { event.preventDefault(); this.commit(input.value.replace(/\n$/, "")); this.finish(false); }
      else if (dir !== 0) { event.preventDefault(); this.finish(false, dir); }
      else if (event.key === "Backspace" && input.value === "") { event.preventDefault(); this.finish(false); }
      else if (this.convertsOn(input, event)) { event.preventDefault(); this.convert(); }
    });
    // Clicking anywhere else keeps the edit and hides the LaTeX.
    input.addEventListener("focusout", (raw) => {
      const next = (raw as FocusEvent).relatedTarget;
      if (!(next instanceof Node && this.sourcePanel?.contains(next))) this.close();
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
    this.close();
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

  /** Hides the LaTeX and puts the caret after the equation (`dir` -1: before it); `cancel` restores the TeX it had, and an equation left empty is removed. */
  private finish(cancel: boolean, dir: 1 | -1 = 1): void {
    if (cancel) this.commit(this.originalTex);
    this.close();
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
    return this.sourcePanel !== null && event.target instanceof Node && this.sourcePanel.contains(event.target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.token++;
    this.close();
  }
}

/** A node view for `math_inline` (`display` false) or `math_display` (`display` true); `loadMath` defaults to the lazy `@labshelf/core/math` import. */
export function createMathView(display: boolean, loadMath?: () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>): NodeViewConstructor {
  const loader = loadMath ?? loadCoreMath;
  return (node, view, getPos) => new MathView(node, view, getPos, display, loader);
}
