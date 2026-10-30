// Shows code cells with their Run button and the stored outputs under them, marking an output out of date when its cell's code hashes to something other than the output's `source`.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { mountOverlay, renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { deriveCodeHash, readOutputImage } from "../item/index.js";
import { setViewNodeAttribute } from "./inlineViews.js";
import { loadCoreMath, renderMathInto, type MathLoader } from "./mathView.js";

/** The value of the `#| label:` line in a cell's `options`, or "". */
function readCellLabel(options: string): string {
  return /^#\|\s*label:\s*(.*?)\s*$/m.exec(options)?.[1] ?? "";
}

const isRunKey = (event: KeyboardEvent): boolean => event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

class CodeCellView implements NodeView {
  readonly dom: HTMLElement;
  private readonly labelText: HTMLElement;
  private readonly langText: HTMLElement;
  private readonly code: HTMLElement;
  private readonly pre: HTMLPreElement;
  private readonly toggle: HTMLButtonElement;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly onRunCell?: (label: string, code: string) => void) {
    this.langText = renderElement("span", { class: "qmd-cell-lang" });
    this.labelText = renderElement("span", { class: "qmd-cell-label" });
    const header = renderElement("div", { class: "qmd-cell-header", contenteditable: "false" }, this.langText, this.labelText);
    if (onRunCell) {
      const run = renderElement("button", { class: "qmd-cell-run", type: "button", title: "Run cell (Ctrl/Cmd+Enter)", "aria-label": "Run cell" }, renderElement("span", { html: renderIcon("play"), "aria-hidden": "true" }), "Run");
      run.addEventListener("click", () => this.run());
      header.append(run);
    }
    this.toggle = renderElement("button", { class: "qmd-cell-toggle", type: "button" });
    this.toggle.addEventListener("click", () => this.showCode(this.pre.hidden === true));
    header.append(this.toggle);
    this.code = renderElement("code", { spellcheck: "false" });
    this.code.contentEditable = String(view.editable);
    this.code.addEventListener("input", () => this.commit());
    this.pre = renderElement("pre", { class: "qmd-cell-code" }, this.code);
    this.dom = renderElement("div", { class: "qmd-cell" }, header, this.pre);
    const label = readCellLabel(node.attrs.options as string);
    let hasResult = false;
    view.state.doc.descendants((child) => { if (label && child.type.name === "output" && child.attrs.cell === label && outputContent(child.attrs.raw as string).trim()) { hasResult = true; } });
    this.showCode(!hasResult || (node.attrs.code as string).split("\n").length <= 12);
    this.dom.addEventListener("keydown", (event) => {
      if (!isRunKey(event) || !this.onRunCell) return;
      event.preventDefault();
      this.run();
    });
    this.render();
  }

  private showCode(show: boolean): void {
    this.pre.hidden = !show;
    this.toggle.textContent = show ? "Hide code" : "Show code";
    this.toggle.setAttribute("aria-expanded", String(show));
    this.dom.classList.toggle("qmd-cell-collapsed", !show);
  }

  private render(): void {
    this.langText.textContent = (this.node.attrs.lang as string | null) ?? "";
    this.labelText.textContent = readCellLabel(this.node.attrs.options as string);
    const code = this.node.attrs.code as string;
    if (this.code.textContent !== code) this.code.textContent = code;
  }

  private run(): void {
    this.onRunCell?.(readCellLabel(this.node.attrs.options as string), this.node.attrs.code as string);
  }

  /** Writes the edited text back; `code` holds whole lines, so a missing final newline is restored. */
  private commit(): void {
    const text = this.code.textContent ?? "";
    const code = text === "" || text.endsWith("\n") ? text : `${text}\n`;
    if (code !== this.node.attrs.code) setViewNodeAttribute(this.view, this.getPos, "code", code);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Node | null;
    return target !== null && (this.code.contains(target) || (target as Element).closest?.(".qmd-cell-header") != null);
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/** A node view for `code_cell`; the Run button and Mod-Enter call `onRunCell(label, code)` and are absent without it. */
export function createCodeCellView(onRunCell?: (label: string, code: string) => void): NodeViewConstructor {
  return (node, view, getPos) => new CodeCellView(node, view, getPos, onRunCell);
}

/** The lines of an output block between its opening line and its closing `:::`. */
function outputContent(raw: string): string {
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
  private badge: HTMLElement | null = null;
  private preview: (() => void) | null = null;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly loadMath: MathLoader) {
    this.body = renderElement("div", { class: "qmd-output-body" });
    this.dom = renderElement("div", { class: "qmd-output", contenteditable: "false" }, renderElement("div", { class: "qmd-output-heading" }, "Result"), this.body);
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

  /** The badge exists only while the output is out of date, so a current output carries no trace of the state. */
  private showStale(stale: boolean): void {
    this.dom.classList.toggle("is-out-of-date", stale);
    if (!stale) {
      this.badge?.remove();
      this.badge = null;
    } else if (!this.badge) {
      this.badge = renderElement("span", { class: "qmd-output-badge", html: renderIcon("warning") }, "Out of date");
      this.dom.prepend(this.badge);
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
