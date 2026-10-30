// Shows the stored output of a code cell as text, a plot or display math, marking it out of date when its cell's code hashes to something other than the output's `source`.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { mountOverlay, renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { deriveCodeHash, readOutputImage } from "../item/index.js";
import { loadCoreMath, renderMathInto, type MathLoader } from "./mathView.js";

/** The value of the `#| label:` line in a cell's `options`, or "". */
export function readCellLabel(options: string): string {
  return /^#\|\s*label:\s*(.*?)\s*$/m.exec(options)?.[1] ?? "";
}

/** The lines of an output block between its opening line and its closing `:::`. */
export function outputContent(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > 0 && lines.at(-1)?.trim() === ":::") lines.pop();
  return lines.slice(1).join("\n");
}

/** Removes a whole code fence from text results while preserving the stored Markdown. */
function plainOutput(text: string): string {
  const content = text.split("\n");
  const fence = /^(`{3,}|~{3,})[^\n]*$/.exec(content[0] ?? "")?.[1];
  const closing = content.at(-1)?.trim() ?? "";
  return fence && closing[0] === fence[0] && closing.length >= fence.length && [...closing].every((char) => char === fence[0])
    ? content.slice(1, -1).join("\n") : content.join("\n");
}

/** The TeX of an output that is one `$$ … $$` block, or null. */
function displayMath(content: string): string | null {
  return /^\s*\$\$([\s\S]*?)\$\$\s*$/.exec(content)?.[1]?.trim() ?? null;
}

function openPlot(src: string, alt: string): () => void {
  const close = renderElement("button", { class: "qmd-plot-close", type: "button", "aria-label": "Close plot", html: renderIcon("x") });
  const panel = renderElement("section", { class: "qmd-plot-preview", role: "dialog", "aria-modal": "true", "aria-label": "Python plot" },
    renderElement("header", { class: "qmd-plot-header" }, renderElement("span", {}, alt), close), renderElement("img", { src, alt }));
  const overlay = mountOverlay(panel, () => undefined);
  close.addEventListener("click", overlay.close);
  close.focus();
  return overlay.close;
}

class OutputView implements NodeView {
  readonly dom: HTMLElement;
  private readonly body: HTMLElement;
  private shownRaw: string | null = null;
  private checkedKey: string | null = null;
  private readonly observer: MutationObserver;
  private destroyed = false;
  private caption: HTMLElement | null = null;
  private preview: (() => void) | null = null;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly loadMath: MathLoader) {
    this.body = renderElement("div", { class: "qmd-output-body" });
    this.dom = renderElement("div", { class: "qmd-output", contenteditable: "false" }, this.body);
    // An unchanged output keeps its view when only its cell changes, so the view watches the editor for edits.
    this.observer = new MutationObserver(() => this.checkSource());
    this.observer.observe(view.dom, { childList: true, subtree: true, characterData: true });
    this.render();
  }

  private render(): void {
    const raw = this.node.attrs.raw as string;
    if (raw !== this.shownRaw) {
      this.preview?.();
      this.preview = null;
      this.shownRaw = raw;
      const content = outputContent(raw);
      const tex = displayMath(content);
      const image = readOutputImage(content);
      this.dom.classList.toggle("qmd-output-figure", image !== null);
      if (image) {
        const expand = renderElement("button", { class: "qmd-output-image-button", type: "button", "aria-label": "Expand plot", title: "Expand plot" }, renderElement("img", { class: "qmd-output-image", src: image.src, alt: image.alt }));
        expand.addEventListener("click", () => { this.preview?.(); this.preview = openPlot(image.src, image.alt); });
        this.body.replaceChildren(expand);
      } else if (tex === null) {
        this.body.replaceChildren(renderElement("pre", { class: "qmd-output-text", text: plainOutput(content) }));
      } else {
        const rendered = renderElement("div", { class: "qmd-math-rendered" });
        const math = renderElement("div", { class: "qmd-math qmd-math-display" }, rendered);
        this.body.replaceChildren(math);
        void renderMathInto(rendered, tex, true, this.loadMath);
      }
    }
    this.checkSource();
  }

  /** The `code` of the cell this output belongs to: the nearest earlier `code_cell` labelled `cell`, or the nearest earlier cell when the output names none. */
  private cellCode(): string | null {
    const pos = this.getPos();
    if (pos === undefined) return null;
    const wanted = this.node.attrs.cell as string;
    let code: string | null = null;
    this.view.state.doc.nodesBetween(0, pos, (child, childPos) => {
      if (childPos >= pos) return false;
      if (child.type.name !== "code_cell") return true;
      if (!wanted || readCellLabel(child.attrs.options as string) === wanted) code = child.attrs.code as string;
      return false;
    });
    return code;
  }

  private checkSource(): void {
    if (this.destroyed) return;
    const code = this.cellCode();
    const source = this.node.attrs.source as string;
    const key = code === null ? null : `${source}\u0000${code}`;
    if (key === this.checkedKey) return;
    this.checkedKey = key;
    if (code === null) {
      this.showStale(false);
      return;
    }
    void deriveCodeHash(code).then((hash) => {
      if (this.destroyed || this.checkedKey !== key) return;
      this.showStale(hash !== source);
    }, () => undefined);
  }

  /** The caption exists only while the output is out of date, so a current output carries no trace of the state; its words carry the state without colour. */
  private showStale(stale: boolean): void {
    this.dom.classList.toggle("is-out-of-date", stale);
    if (!stale) {
      this.caption?.remove();
      this.caption = null;
    } else if (!this.caption) {
      this.caption = renderElement("div", { class: "qmd-output-caption", role: "note" },
        renderElement("span", { class: "qmd-output-caption-icon", html: renderIcon("warning"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-output-caption-text" }, "Out of date — the code changed since this ran"));
      this.dom.prepend(this.caption);
    }
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.preview?.();
    this.observer.disconnect();
  }
}

/** A node view for `output`: text in monospace, a `$$ … $$` output as display math, and `is-out-of-date` when its cell's code hash differs from `source`. */
export function createOutputView(loadMath?: () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>): NodeViewConstructor {
  const loader = loadMath ?? loadCoreMath;
  return (node, view, getPos) => new OutputView(node, view, getPos, loader);
}
