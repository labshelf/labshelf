// Shows typeset inline and display equations, with LaTeX editing in a compact field attached to the equation.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { exitNode, registerNodeEditor, setViewNodeAttribute, type EditSide } from "./inlineViews.js";

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

const HINT = { display: "↵ finish · ⇧↵ new line · arrows leave · Esc cancel", inline: "↵ finish · ← → leave · Esc cancel" };
const PLACEHOLDER = { display: "Empty equation — click to write LaTeX", inline: "LaTeX" };

/**
 * Shows an equation typeset. Clicking it, Enter on it or creating it empty opens a compact LaTeX field attached to it:
 * under a display equation, whose preview updates as you type, or in a small popup under an inline one.
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

  /** While editing, the parse error shows as text under the field. */
  private showError(): void {
    if (!this.errorText) return;
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

  /** Opens the LaTeX field with the caret at its `side`: the end when clicked, the side the caret came from when arrowed into. */
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
      ? renderElement("textarea", { rows: 1, class: "qmd-math-input", spellcheck: "false", "aria-label": "TeX source", placeholder: "LaTeX, e.g. \\frac{a}{b}" })
      : renderElement("input", { class: "qmd-math-input", type: "text", spellcheck: "false", "aria-label": "TeX source", placeholder: "LaTeX" });
    this.originalTex = this.tex;
    input.value = this.tex;
    const fit = (): void => { if (input instanceof HTMLTextAreaElement) input.rows = Math.max(1, input.value.split("\n").length); };
    fit();
    input.addEventListener("input", () => { fit(); this.commit(input.value); });
    input.addEventListener("keydown", (raw) => {
      const event = raw as KeyboardEvent;
      if (event.isComposing) return;
      const dir = this.leaveDirection(input, event);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.finish(true); }
      else if (event.key === "Enter" && (!this.display || !event.shiftKey)) { event.preventDefault(); this.finish(false); }
      else if (dir !== 0) { event.preventDefault(); this.finish(false, dir); }
      else if (event.key === "Backspace" && input.value === "") { event.preventDefault(); this.finish(false); }
    });
    // Clicking anywhere else keeps the edit and closes the field.
    input.addEventListener("focusout", (raw) => {
      const next = (raw as FocusEvent).relatedTarget;
      if (!(next instanceof Node && this.sourcePanel?.contains(next))) this.close();
    });
    this.editor = input;
    this.errorText = renderElement("span", { class: "qmd-math-edit-error", role: "alert", hidden: true });
    this.sourcePanel = renderElement("span", { class: "qmd-math-edit", contenteditable: "false" },
      input, this.errorText, renderElement("span", { class: "qmd-math-hint", "aria-hidden": "true", text: HINT[this.display ? "display" : "inline"] }));
    this.showError();
    this.dom.append(this.sourcePanel);
    if (!this.display) this.placePopup(this.sourcePanel);
    queueMicrotask(() => {
      if (this.editor !== input) return;
      input.focus();
      const at = side === "start" ? 0 : input.value.length;
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

  /** Places the inline popup under the formula, kept inside the window. */
  private placePopup(panel: HTMLElement): void {
    const rect = this.dom.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - panel.offsetHeight - 8))}px`;
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
    this.close();
  }

  /** Removes the field, keeping what was written. */
  private close(): void {
    this.dom.classList.remove("qmd-math-editing");
    const panel = this.sourcePanel;
    this.sourcePanel = null;
    this.editor = null;
    this.errorText = null;
    panel?.remove();
  }

  /** Closes the field and puts the caret after the equation (`dir` -1: before it); `cancel` restores the TeX it had, and an equation left empty is removed. */
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
