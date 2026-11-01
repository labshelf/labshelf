// Shows a drawing block: its stored SVG (through the sanitizer, or redrawn from its model once MathJax loads when the
// stored one fails), a note when its TikZ was edited by hand, and the drawing editor opened in place on click or Enter.
import type { Node as ProseNode } from "prosemirror-model";
import { Selection } from "prosemirror-state";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { askDialog } from "../../ui/dom/widgets/dialog.js";
import { showToast } from "../../ui/dom/widgets/toast.js";
import { formatDrawingBlock, readDrawingBlock, type DrawingBlock } from "../drawing/block.js";
import { layoutDrawing, type LabelBox } from "../drawing/layout.js";
import type { DrawingModel } from "../drawing/model.js";
import { paintDrawingPng, type CanvasFactory } from "../drawing/png.js";
import { sanitizeDrawingSvg } from "../drawing/sanitize.js";
import { formatDrawingSvg } from "../drawing/svg.js";
import { formatTikz } from "../drawing/tikz.js";
import { registerNodeEditor } from "./inlineViews.js";
import type { MathLoader } from "./mathView.js";

interface DrawingEditorHandle { destroy(): void }

export type DrawingEditorLoader = () => Promise<{ openDrawingEditor(host: HTMLElement, model: import("../drawing/model.js").DrawingModel, done: (model: import("../drawing/model.js").DrawingModel | null) => void): DrawingEditorHandle }>;

const HAND_EDITED_QUESTION = "This TikZ was edited by hand. Editing the drawing replaces it.";
const BOM = "﻿";
const UNIT_PX: Record<string, number> = { ex: 8, em: 16, px: 1 };

const DOM_CANVAS: CanvasFactory = {
  create(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

/** An SVG element from markup, without any `style` attribute (the webview CSP forbids them); null when the markup holds no SVG. */
function parseSvg(markup: string): Element | null {
  const parsed = new DOMParser().parseFromString(markup, "text/html").querySelector("svg");
  if (!parsed) return null;
  for (const node of [parsed, ...Array.from(parsed.querySelectorAll("[style]"))]) node.removeAttribute("style");
  return document.importNode(parsed, true);
}

function dimension(markup: string, name: "width" | "height"): number {
  const match = new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)(ex|em|px)?"`).exec(markup);
  return match ? Number(match[1]) * (UNIT_PX[match[2] ?? "px"] ?? 1) : 0;
}

/** The label renderer and measurer MathJax gives: a label's size in CSS pixels comes from its SVG's width and height. */
function labelTools(math: Awaited<ReturnType<MathLoader>>): { renderLabel(tex: string): string; measure(tex: string): LabelBox } {
  const renderLabel = (tex: string): string => math.renderMathSvg(tex, false);
  return { renderLabel, measure: (tex) => { const markup = renderLabel(tex); return { width: dimension(markup, "width"), height: dimension(markup, "height") }; } };
}

const isEmptyModel = (model: DrawingModel): boolean => model.points.length === 0 && model.items.length === 0;

class DrawingView implements NodeView {
  readonly dom: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly note: HTMLElement;
  private host: HTMLElement | null = null;
  private handle: DrawingEditorHandle | null = null;
  private opening = false;
  private committing = false;
  private token = 0;
  private destroyed = false;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly loadEditor: DrawingEditorLoader, private readonly loadMath: MathLoader) {
    this.figure = renderElement("div", { class: "qmd-drawing-figure" });
    this.note = renderElement("div", { class: "qmd-drawing-hand-edited", text: "TikZ edited by hand" });
    this.dom = renderElement("div", { class: "qmd-drawing", title: view.editable ? "Click to edit drawing" : "" }, this.figure);
    this.dom.classList.toggle("is-readonly", !view.editable);
    this.dom.addEventListener("click", (event) => {
      if (event.target instanceof Node && this.host?.contains(event.target)) return;
      void this.open();
    });
    registerNodeEditor(this.dom, () => { void this.open(); });
    this.render();
  }

  private get raw(): string {
    return this.node.attrs.raw as string;
  }

  /** The block `raw` holds, or null when it is empty or unreadable. */
  private read(): DrawingBlock | null {
    return this.raw.trim() === "" ? null : readDrawingBlock(this.raw.replace(/^﻿/, ""));
  }

  private render(): void {
    const token = ++this.token;
    this.dom.classList.toggle("is-readonly", !this.view.editable);
    this.dom.title = this.view.editable ? "Click to edit drawing" : "";
    const block = this.read();
    this.showNote(block?.handEdited === true);
    if (this.raw.trim() === "") {
      this.figure.replaceChildren(renderElement("div", { class: "qmd-drawing-placeholder", text: "Empty drawing" }));
      return;
    }
    if (!block) {
      this.figure.replaceChildren(renderElement("div", { class: "qmd-drawing-error", text: "This drawing could not be read." }));
      return;
    }
    const clean = sanitizeDrawingSvg(block.svg);
    const stored = clean === null ? null : parseSvg(clean);
    if (stored) {
      this.figure.replaceChildren(stored);
      return;
    }
    this.figure.replaceChildren(renderElement("div", { class: "qmd-drawing-placeholder", text: "Drawing" }));
    void this.redraw(block.model, token);
  }

  /** The "TikZ edited by hand" note is in the DOM only while it applies. */
  private showNote(shown: boolean): void {
    if (shown) this.figure.after(this.note);
    else this.note.remove();
  }

  /** Draws the model itself, for a stored SVG the sanitizer refused. */
  private async redraw(model: DrawingModel, token: number): Promise<void> {
    try {
      const tools = labelTools(await this.loadMath());
      const svg = parseSvg(formatDrawingSvg(model, layoutDrawing(model, tools.measure), tools.renderLabel));
      if (token !== this.token || this.destroyed) return;
      this.figure.replaceChildren(svg ?? renderElement("div", { class: "qmd-drawing-error", text: "This drawing could not be drawn." }));
    } catch {
      if (token === this.token && !this.destroyed) this.figure.replaceChildren(renderElement("div", { class: "qmd-drawing-error", text: "This drawing could not be drawn." }));
    }
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.raw !== this.node.attrs.raw;
    this.node = node;
    if (changed) this.render();
    return true;
  }

  /** Opens the drawing editor in place, after asking when the block's TikZ was edited by hand. */
  private async open(): Promise<void> {
    if (!this.view.editable || this.opening || this.handle || this.destroyed) return;
    const block = this.read();
    if (this.raw.trim() !== "" && !block) return;
    this.opening = true;
    try {
      if (block?.handEdited && !(await askDialog("Edit drawing", HAND_EDITED_QUESTION, "Edit drawing"))) return;
      const editor = await this.loadEditor();
      if (this.destroyed || this.handle) return;
      const host = renderElement("div", { class: "qmd-drawing-editor" });
      this.host = host;
      this.dom.append(host);
      this.figure.hidden = true;
      this.showNote(false);
      const model: DrawingModel = block ? block.model : ({ v: 1, points: [], items: [] } as unknown as DrawingModel);
      this.handle = editor.openDrawingEditor(host, model, (done) => { void this.finish(done); });
    } catch (error) {
      this.closeEditor();
      showToast(`Could not open the drawing editor: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      this.opening = false;
    }
  }

  private closeEditor(): void {
    const handle = this.handle;
    const host = this.host;
    this.handle = null;
    this.host = null;
    handle?.destroy();
    host?.remove();
    this.figure.hidden = false;
    this.showNote(this.read()?.handEdited === true);
  }

  /** The editor's Done: nothing for null, the node's removal for an empty model, otherwise one commit of the whole block. */
  private async finish(model: DrawingModel | null): Promise<void> {
    if (this.committing || this.destroyed) return;
    if (model === null) { this.closeEditor(); return; }
    if (isEmptyModel(model)) { this.closeEditor(); this.removeNode(); return; }
    this.committing = true;
    try {
      const raw = await this.buildRaw(model);
      if (raw === null || this.destroyed || this.view.isDestroyed) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      this.closeEditor();
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, raw }));
      this.view.focus();
    } catch (error) {
      showToast(`Could not save the drawing: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      this.committing = false;
    }
  }

  /** Lays the model out and writes its whole stored block; null (with a toast) when the block cannot be made or is over the cap. */
  private async buildRaw(model: DrawingModel): Promise<string | null> {
    const tools = labelTools(await this.loadMath());
    const layout = layoutDrawing(model, tools.measure);
    const tikz = formatTikz(model, layout);
    const svg = formatDrawingSvg(model, layout, tools.renderLabel);
    const png = paintDrawingPng(svg, DOM_CANVAS);
    if (png === null) { showToast("The drawing could not be painted.", "error"); return null; }
    const eol = this.view.state.doc.attrs.eol === "\r\n" || this.raw.includes("\r\n") ? "\r\n" : "\n";
    const block = formatDrawingBlock({ model, tikz, png, svg, alt: this.read()?.alt ?? "Drawing" }, eol);
    if (block === null) { showToast("This drawing is too large to save.", "error"); return null; }
    return (this.raw.startsWith(BOM) ? BOM : "") + block + eol;
  }

  /** Removes the node, leaving a paragraph when it was the only block. */
  private removeNode(): void {
    const pos = this.getPos();
    if (pos === undefined || this.view.isDestroyed) return;
    const { state } = this.view;
    const tr = state.tr;
    if (state.doc.childCount === 1) tr.replaceWith(pos, pos + this.node.nodeSize, state.schema.nodes.paragraph!.create());
    else tr.delete(pos, pos + this.node.nodeSize);
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  selectNode(): void { this.dom.classList.add("ProseMirror-selectednode"); }

  deselectNode(): void { this.dom.classList.remove("ProseMirror-selectednode"); }

  stopEvent(event: Event): boolean {
    return this.host !== null && event.target instanceof Node && this.host.contains(event.target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.token++;
    this.closeEditor();
  }
}

/** A node view for the `drawing` block; `loadEditor` brings in the drawing editor on first use and `loadMath` MathJax, only when a label has to be drawn. */
export function createDrawingView(loadEditor: DrawingEditorLoader, loadMath: import("./mathView.js").MathLoader): import("prosemirror-view").NodeViewConstructor {
  const construct: NodeViewConstructor = (node, view, getPos) => new DrawingView(node, view, getPos, loadEditor, loadMath);
  return construct;
}
