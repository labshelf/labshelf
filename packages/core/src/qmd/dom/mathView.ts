// Shows `math_inline` and `math_display` nodes as MathJax SVG, loading MathJax only when a math node first renders, with the TeX source editable while the node is selected.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
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
  private editor: HTMLInputElement | null = null;
  private token = 0;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly display: boolean, private readonly loadMath: MathLoader) {
    this.dom = renderElement(display ? "div" : "span", { class: display ? "qmd-math qmd-math-display" : "qmd-math qmd-math-inline" });
    this.rendered = renderElement(display ? "div" : "span", { class: "qmd-math-rendered" });
    this.dom.append(this.rendered);
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

  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
    if (this.editor || !this.view.editable) return;
    const input = renderElement("input", { class: "qmd-math-source qmd-math-input", type: "text", spellcheck: "false", "aria-label": "TeX source" });
    input.value = this.tex;
    input.addEventListener("input", () => this.commit(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      this.view.focus();
    });
    this.editor = input;
    this.dom.append(input);
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
    this.editor?.remove();
    this.editor = null;
  }

  private commit(tex: string): void {
    if (tex !== this.tex) setViewNodeAttribute(this.view, this.getPos, "tex", tex);
  }

  stopEvent(event: Event): boolean {
    return this.editor !== null && event.target === this.editor;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.token++;
  }
}

/** A node view for `math_inline` (`display` false) or `math_display` (`display` true); `loadMath` defaults to the lazy `@labshelf/core/math` import. */
export function createMathView(display: boolean, loadMath?: () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>): NodeViewConstructor {
  const loader = loadMath ?? loadCoreMath;
  return (node, view, getPos) => new MathView(node, view, getPos, display, loader);
}
