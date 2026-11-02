// Shows a chart block: the model drawn with Plotly in the page theme (redrawn on a theme change, purged when the view goes),
// with the stored PNG while Plotly loads, when it fails or for what is not drawn yet, and a placeholder when there is no PNG.
import type { Node as ProseNode } from "prosemirror-model";
import type { NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { readChartBlock, type ChartBlock } from "../chart/block.js";
import { chartFigure, chartKindLabel, type ChartFigure, type ChartTheme } from "../chart/figure.js";
import { unwatchTheme, watchTheme } from "./plotRender.js";
import { RawNodeView } from "./rawNodeView.js";
import { loadCorePlotly, readPlotTheme, sameTheme, type PlotlyApi, type PlotlyLoader, type PlotTheme } from "./plotView.js";

const BOM = /^﻿/;
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

  constructor(node: ProseNode, private readonly loadPlotly: PlotlyLoader) {
    super(node);
    this.plot = renderElement("div", { class: "qmd-chart-plot" });
    this.plot.hidden = true;
    this.fallback = renderElement("div", { class: "qmd-chart-fallback" });
    this.dom = renderElement("div", { class: "qmd-chart" }, this.plot, this.fallback);
    this.render();
  }

  /** The block `raw` holds, or null when it is unreadable. */
  private read(): ChartBlock | null {
    return readChartBlock((this.node.attrs.raw as string).replace(BOM, ""));
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
    const block = this.read();
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
    if (this.watchingTheme) unwatchTheme(this.themeListener);
    this.plotly?.purge(this.plot);
  }
}

/** A node view for the `chart` block; `loadPlotly` brings in Plotly when a chart is drawn. `openEditor` is the chart editor's loader, unused until the editor exists (plan charts 2.1). */
export function createChartView(loadPlotly?: import('./plotView.js').PlotlyLoader, openEditor?: () => Promise<unknown>): import('prosemirror-view').NodeViewConstructor {
  void openEditor;
  const construct: NodeViewConstructor = (node) => new ChartView(node, loadPlotly ?? loadCorePlotly);
  return construct;
}
