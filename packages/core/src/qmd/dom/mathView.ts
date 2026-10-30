// Shows typeset inline and display equations, with explicit LaTeX editing in a separate field.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, Selection, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement, renderIcon } from "../../ui/dom/index.js";
import { setViewNodeAttribute } from "./inlineViews.js";

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

/** Renders `tex` into `target`: the TeX in `.qmd-math-source` while MathJax loads, then the SVG, or `.qmd-math-error` with the parser message in `title`. */
export async function renderMathInto(target: HTMLElement, tex: string, display: boolean, loadMath: MathLoader): Promise<void> {
  target.replaceChildren(renderElement("code", { class: "qmd-math-source", text: tex }));
  try {
    const math = await loadMath();
    target.replaceChildren(parseMathSvg(math.renderMathSvg(tex, display)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    target.replaceChildren(renderElement("code", { class: "qmd-math-error", title: message, text: tex }));
  }
}

class MathView implements NodeView {
  readonly dom: HTMLElement;
  private readonly rendered: HTMLElement;
  private editor: HTMLInputElement | HTMLTextAreaElement | null = null;
  private sourcePanel: HTMLElement | null = null;
  private originalTex = "";
  private token = 0;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly display: boolean, private readonly loadMath: MathLoader) {
    this.dom = renderElement(display ? "div" : "span", { class: display ? "qmd-math qmd-math-display" : "qmd-math qmd-math-inline", title: "Click to edit equation" });
    this.rendered = renderElement(display ? "div" : "span", { class: "qmd-math-rendered" });
    this.dom.append(this.rendered);
    if (view.editable && display) {
      const edit = renderElement("button", { class: "qmd-math-edit-button", type: "button", "aria-label": "Edit equation", contenteditable: "false", html: renderIcon("edit") });
      edit.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); this.editSource(); });
      this.dom.append(edit);
    }
    this.dom.addEventListener("click", (event) => {
      if (view.editable && event.target instanceof Node && this.rendered.contains(event.target)) { this.editSource(); }
    });
    this.render();
  }

  private get tex(): string {
    return this.node.attrs.tex as string;
  }

  private render(): void {
    const token = ++this.token;
    const target = renderElement(this.display ? "div" : "span", { class: "qmd-math-rendered" });
    this.rendered.replaceChildren(renderElement("code", { class: "qmd-math-source", text: this.tex }));
    void renderMathInto(target, this.tex, this.display, this.loadMath).then(() => {
      if (token === this.token) this.rendered.replaceChildren(...Array.from(target.childNodes));
    });
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

  private editSource(): void {
    if (this.editor || !this.view.editable) return;
    const pos = this.getPos();
    if (pos === undefined) { return; }
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    this.dom.classList.add("qmd-math-editing");
    const input = this.display
      ? renderElement("textarea", { rows: 3, class: "qmd-math-input", spellcheck: "false", "aria-label": "TeX source" })
      : renderElement("input", { class: "qmd-math-input", type: "text", spellcheck: "false", "aria-label": "TeX source" });
    this.originalTex = this.tex;
    input.value = this.tex;
    input.addEventListener("input", () => this.commit(input.value));
    input.addEventListener("keydown", (raw) => {
      const event = raw as KeyboardEvent;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.finish(true); }
      else if (event.key === "Enter" && (!this.display || event.ctrlKey || event.metaKey)) { event.preventDefault(); this.finish(false); }
    });
    const apply = renderElement("button", { class: "qmd-math-apply", type: "button", text: "Apply", title: "Apply (Ctrl/Cmd+Enter)" });
    const cancel = renderElement("button", { class: "qmd-math-cancel", type: "button", text: "Cancel" });
    apply.addEventListener("click", () => this.finish(false));
    cancel.addEventListener("click", () => this.finish(true));
    this.editor = input;
    this.sourcePanel = renderElement("span", { class: "qmd-math-edit", contenteditable: "false" },
      renderElement("label", { class: "qmd-math-field" }, renderElement("span", { class: "qmd-math-field-label", text: "LaTeX" }), input),
      renderElement("span", { class: "qmd-math-actions" }, cancel, apply));
    this.dom.append(this.sourcePanel);
    if (!this.display) {
      const rect = this.dom.getBoundingClientRect();
      this.sourcePanel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - this.sourcePanel.offsetWidth - 8))}px`;
      this.sourcePanel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - this.sourcePanel.offsetHeight - 8))}px`;
    }
    queueMicrotask(() => this.editor?.focus());
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode", "qmd-math-editing");
    this.sourcePanel?.remove();
    this.sourcePanel = null;
    this.editor = null;
  }

  private finish(cancel: boolean): void {
    if (cancel) { this.commit(this.originalTex); }
    const pos = this.getPos();
    if (pos === undefined) { return; }
    const tr = this.view.state.tr;
    const after = pos + this.node.nodeSize;
    if (this.display && !tr.doc.resolve(after).nodeAfter) {
      if (cancel) { this.deselectNode(); this.view.focus(); return; }
      tr.insert(after, this.view.state.schema.nodes["paragraph"]!.create());
    }
    tr.setSelection(this.display ? Selection.near(tr.doc.resolve(after), 1) : TextSelection.create(tr.doc, after));
    this.view.dispatch(tr);
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
    this.editor = null;
  }
}

/** A node view for `math_inline` (`display` false) or `math_display` (`display` true); `loadMath` defaults to the lazy `@labshelf/core/math` import. */
export function createMathView(display: boolean, loadMath?: () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>): NodeViewConstructor {
  const loader = loadMath ?? loadCoreMath;
  return (node, view, getPos) => new MathView(node, view, getPos, display, loader);
}
