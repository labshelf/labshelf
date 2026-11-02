// Shows a chart block: the model drawn with Plotly in the page theme (redrawn on a theme change, purged when the view goes),
// with the stored PNG while Plotly loads, when it fails or for what is not drawn yet, and a placeholder when there is no PNG.
// Click or Enter opens the chart editor; its writes replace the whole block.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView, NodeViewConstructor } from "prosemirror-view";
import { askDialog, renderElement, showToast } from "../../ui/dom/index.js";
import { chartFigure, chartKindLabel, formatChartBlock, readChartBlock, type ChartBlock, type ChartFigure, type ChartModel, type ChartTheme } from "../chart/index.js";
import type { loadChartEditor } from "./chartEditor/index.js";
import { registerNodeEditor } from "./inlineViews.js";
import { unwatchTheme, watchTheme } from "./plotRender.js";
import { RawNodeView } from "./rawNodeView.js";
import { loadCorePlotly, readPlotTheme, sameTheme, type PlotlyApi, type PlotlyLoader, type PlotTheme } from "./plotView.js";

/** Loads the chart editor chunk. */
export type ChartEditorLoader = typeof loadChartEditor;

type ChartEditorResult = Parameters<Awaited<ReturnType<ChartEditorLoader>>["openChartEditor"]>[0]["done"] extends (result: infer R) => void ? R : never;

const BOM_CHAR = "﻿";
const BOM = /^﻿/;
const HAND_EDITED_QUESTION = "This chart's pgfplots code was edited by hand. Editing the chart replaces it.";
const CONFIG = { displaylogo: false, responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: false };
/** Stands in for the page theme where only the presence of traces matters. */
const PROBE_THEME: ChartTheme = { fg: "", muted: "", grid: "", font: "", palette: [""] };

function chartTheme(theme: PlotTheme): ChartTheme {
  return { fg: theme.text, muted: theme.muted, grid: theme.grid, font: theme.font, palette: theme.palette };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class ChartView extends RawNodeView {
  readonly dom: HTMLElement;
  private readonly plot: HTMLElement;
  private readonly fallback: HTMLElement;
  private readonly exportNote: HTMLElement;
  private editor: { close(): void } | null = null;
  private opening = false;
  private plotly: PlotlyApi | null = null;
  private loading = false;
  private loadError: { error: unknown } | null = null;
  private drawnTheme: PlotTheme | null = null;
  private drawn = false;
  private busy = false;
  private dirty = false;
  private watchingTheme = false;
  private readonly themeListener = (): void => this.onTheme();
  private destroyed = false;

  constructor(node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly loadPlotly: PlotlyLoader, private readonly loadEditor: ChartEditorLoader | undefined) {
    super(node);
    this.plot = renderElement("div", { class: "qmd-chart-plot" });
    this.plot.hidden = true;
    this.fallback = renderElement("div", { class: "qmd-chart-fallback" });
    this.exportNote = renderElement("div", { class: "qmd-chart-note", text: "No image for export yet" });
    this.dom = renderElement("div", { class: "qmd-chart" }, this.plot, this.fallback);
    if (loadEditor) {
      this.dom.addEventListener("click", () => { void this.open(); });
      registerNodeEditor(this.dom, () => { void this.open(); });
      this.dom.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || !this.isSelected()) return;
        event.preventDefault();
        void this.open();
      });
    }
    this.render();
  }

  /** Whether this chart is the selected node. */
  private isSelected(): boolean {
    const { selection } = this.view.state;
    return selection instanceof NodeSelection && selection.from === this.getPos();
  }

  private get raw(): string {
    return this.node.attrs.raw as string;
  }

  /** The block `raw` holds, or null when it is empty or unreadable. */
  private read(): ChartBlock | null {
    return this.raw.trim() === "" ? null : readChartBlock(this.raw.replace(BOM, ""));
  }

  /** Opens the chart editor over the note, after asking when the block's pgfplots part was edited by hand. */
  private async open(): Promise<void> {
    const loadEditor = this.loadEditor;
    if (!loadEditor || !this.view.editable || this.opening || this.destroyed) return;
    const empty = this.raw.trim() === "";
    const block = this.read();
    if (!empty && !block) return;
    this.opening = true;
    try {
      if (block && isHandEdited(block) && !(await askDialog("Edit chart", HAND_EDITED_QUESTION, "Edit chart"))) return;
      const editor = await loadEditor();
      if (this.destroyed) return;
      this.editor?.close();
      this.editor = editor.openChartEditor({ model: block?.model ?? null, loadPlotly: this.loadPlotly, done: (result) => this.finish(result) });
    } catch (error) {
      showToast(`Could not open the chart editor: ${errorText(error)}`, "error");
    } finally {
      this.opening = false;
    }
  }

  /** The editor closed without writing: a chart still empty (just inserted, no type picked) goes, in the undo step of its insertion. */
  private removeIfEmpty(): void {
    if (this.destroyed || this.view.isDestroyed || this.raw.trim() !== "") return;
    const pos = this.getPos();
    if (pos === undefined || this.view.state.doc.nodeAt(pos)?.type !== this.node.type) return;
    // An appended transaction joins the history event before it instead of starting its own.
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize).setMeta("appendedTransaction", this.view.state.tr);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /** The editor's write: one commit of the whole block; null (the editor closed without writing) changes nothing but the removal of an empty chart. */
  private finish(result: ChartEditorResult): void {
    if (result === null) { this.editor = null; this.removeIfEmpty(); return; }
    if (this.destroyed || this.view.isDestroyed) return;
    const raw = this.buildRaw(result.model, result.png);
    const pos = this.getPos();
    if (raw === null || pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, raw }));
  }

  /** The stored block for `model` in the note's line ending, keeping a byte order mark; null (with a toast) when it is over the cap. */
  private buildRaw(model: ChartModel, png: { dataUrl: string; widthCm: number; alt: string } | null): string | null {
    const eol = this.view.state.doc.attrs.eol === "\r\n" || this.raw.includes("\r\n") ? "\r\n" : "\n";
    const block = formatChartBlock({ model, png, pgf: null }, eol);
    if (block === null) { showToast("This chart is too large to save.", "error"); return null; }
    return (this.raw.startsWith(BOM_CHAR) ? BOM_CHAR : "") + block + eol;
  }

  /** The figure of the block in the theme the plot element shows. */
  private figureOf(block: ChartBlock, theme: ChartTheme): ChartFigure {
    return chartFigure(block.model, block.model.data ?? null, theme);
  }

  /** Shows the stored PNG, or a placeholder naming the chart's kind; `note` is shown under it. */
  private showFallback(block: ChartBlock | null, note: string | null): void {
    this.plot.hidden = true;
    this.fallback.hidden = false;
    const children: HTMLElement[] = [];
    if (block?.png) {
      children.push(renderElement("img", { class: "qmd-chart-image", src: block.png.dataUrl, alt: block.png.alt }));
    } else {
      children.push(renderElement("div", { class: "qmd-chart-placeholder", text: block ? `${chartKindLabel(block.model.kind)} chart` : "This chart could not be read." }));
    }
    if (note !== null) children.push(renderElement("div", { class: "qmd-chart-note", text: note }));
    this.fallback.replaceChildren(...children);
  }

  protected render(): void {
    const editable = this.loadEditor !== undefined && this.view.editable;
    this.dom.classList.toggle("is-readonly", !editable);
    this.dom.title = editable ? "Click to edit chart" : "";
    const block = this.read();
    // The note is in the DOM only while it applies.
    if (block !== null && block.png === null) this.dom.append(this.exportNote);
    else this.exportNote.remove();
    if (this.raw.trim() === "") {
      this.plot.hidden = true;
      this.fallback.hidden = false;
      this.fallback.replaceChildren(renderElement("div", { class: "qmd-chart-placeholder", text: "Empty chart" }));
      return;
    }
    if (!block) { this.showFallback(null, null); return; }
    if (this.figureOf(block, PROBE_THEME).data.length === 0) {
      this.showFallback(block, block.png ? "Shown as stored image" : null);
      return;
    }
    if (this.loadError) { this.showFallback(block, block.png ? null : errorText(this.loadError.error)); return; }
    if (!this.drawn) this.showFallback(block, null);
    this.load();
    this.draw();
  }

  /** Loads Plotly once for this view, then draws. */
  private load(): void {
    if (this.plotly || this.loading || this.loadError) return;
    this.loading = true;
    this.loadPlotly().then(
      (api) => {
        this.loading = false;
        if (this.destroyed) return;
        this.plotly = api;
        watchTheme(this.themeListener);
        this.watchingTheme = true;
        this.draw();
      },
      (error: unknown) => {
        this.loading = false;
        if (this.destroyed) return;
        this.loadError = { error };
        this.render();
      },
    );
  }

  private onTheme(): void {
    if (this.destroyed || !this.drawnTheme) return;
    if (sameTheme(readPlotTheme(this.plot), this.drawnTheme)) return;
    this.draw();
  }

  /** Draws the current block with Plotly; a call while one draw runs draws again once it ends. */
  private draw(): void {
    const api = this.plotly;
    if (!api || this.destroyed) return;
    if (this.busy) { this.dirty = true; return; }
    const block = this.read();
    if (!block) return;
    const theme = readPlotTheme(this.plot);
    const figure = this.figureOf(block, chartTheme(theme));
    if (figure.data.length === 0) return;
    this.busy = true;
    this.dirty = false;
    this.drawnTheme = theme;
    let result: Promise<unknown>;
    try {
      result = api.react(this.plot, figure.data, figure.layout, CONFIG);
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(
      () => {
        this.busy = false;
        if (this.destroyed) return;
        this.drawn = true;
        this.plot.hidden = false;
        this.fallback.hidden = true;
        this.fallback.replaceChildren();
        if (this.dirty) this.draw();
      },
      (error: unknown) => {
        this.busy = false;
        if (this.destroyed) return;
        this.drawn = false;
        this.showFallback(block, block.png ? null : errorText(error));
        if (this.dirty) this.draw();
      },
    );
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editor?.close();
    this.editor = null;
    if (this.watchingTheme) unwatchTheme(this.themeListener);
    this.plotly?.purge(this.plot);
  }
}

/** Whether the block's pgfplots part was edited by hand, so that a write from the editor would replace that work. */
function isHandEdited(block: ChartBlock): boolean {
  return block.pgf !== null && block.handEdited;
}

/** A node view for the `chart` block; `loadPlotly` brings in Plotly when a chart is drawn, `openEditor` the chart editor on click or Enter (without it the chart only shows). */
export function createChartView(loadPlotly?: PlotlyLoader, openEditor?: ChartEditorLoader): NodeViewConstructor {
  const construct: NodeViewConstructor = (node, view, getPos) => new ChartView(node, view, getPos, loadPlotly ?? loadCorePlotly, openEditor);
  return construct;
}
