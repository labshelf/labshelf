// Shows a figure block: a drawing as its stored SVG (through the sanitizer, or redrawn from its model when that fails), a plot
// or data figure drawn with Plotly in the page theme (redrawn on a theme change, purged when the view goes), the stored PNG
// while Plotly loads or when it fails, and a placeholder without one. A data figure whose table is in a CSV (`src`) reads it
// through the note files. A double click or Enter opens the figure editor; its writes replace the whole block and keep the
// opener's other attributes. The opener's `width=` sizes the figure's box and its `fig-align` places it (centred by default); the
// width field and alignment buttons sit at the top right of the full-width row. The plot element gets a fixed height, or
// Plotly's responsive resize would collapse its paper.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView, NodeViewConstructor } from "prosemirror-view";
import { askDialog, renderElement, showToast } from "../../ui/dom/index.js";
import { figureKindLabel, figurePlotly, formatFigureBlock, readFigureBlock, parseCsv, type ChartFigure, type ChartTable, type ChartTheme, type FigureBlock, type FigureModel } from "../chart/index.js";
import { carryFigureAttributes, figureAttributes, readAttrAlign, readAttrWidth, setFigureAlign, setFigureWidth, type MediaAlign } from "../editor/index.js";
import type { NoteFilesPort } from "../noteFiles.js";
import { drawingSvg, parseSvg } from "./drawingRender.js";
import { sanitizeDrawingSvg } from "./drawingSanitize.js";
import type { FigureEditorResult, loadFigureEditor } from "./figureEditor/index.js";
import { registerNodeEditor } from "./inlineViews.js";
import type { MathLoader } from "./mathView.js";
import { passWheelToPage, unwatchTheme, watchTheme } from "./plotRender.js";
import { RawNodeView } from "./rawNodeView.js";
import { loadCorePlotly, readPlotTheme, sameTheme, type PlotlyApi, type PlotlyLoader, type PlotTheme } from "./plotView.js";
import { mountMediaControls, showMediaLayout, type MediaControls } from "./mediaControls.js";

/** Loads the figure editor chunk. */
export type FigureEditorLoader = typeof loadFigureEditor;

/** The parsed table of `src`; no port, a missing file or a failed read give `missing` = "Data file <src> not found". */
export async function readChartSource(files: NoteFilesPort | undefined, src: string): Promise<{ table: ChartTable; missing: null } | { table: null; missing: string }> {
  const missing = { table: null, missing: `Data file ${src} not found` } as const;
  if (files === undefined) return missing;
  let bytes: Uint8Array | null;
  try {
    bytes = await files.read(src);
  } catch {
    return missing;
  }
  if (bytes === null) return missing;
  return { table: parseCsv(new TextDecoder().decode(bytes)).table, missing: null };
}

const BOM_CHAR = "﻿";
const BOM = /^﻿/;
const HAND_EDITED_QUESTION = "This figure's LaTeX was edited by hand. Editing the figure replaces it.";
const CONFIG = { displaylogo: false, responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: false };
/** Stands in for the page theme where only the presence of traces matters. */
const PROBE_THEME: ChartTheme = { fg: "", muted: "", grid: "", font: "", palette: [""] };

function chartTheme(theme: PlotTheme): ChartTheme {
  return { fg: theme.text, muted: theme.muted, grid: theme.grid, font: theme.font, palette: theme.palette };
}

/**
 * The block that replaces `raw` with `parts`, in the note's line ending (CRLF when `crlf` or `raw` has it), keeping a byte order
 * mark and the opener's other attributes; a picture that would push it over the cap is left out (a plot or data figure is then
 * saved image-only). Null when it still does not fit.
 */
export function figureRaw(raw: string, parts: Omit<FigureBlock, "handEdited">, crlf: boolean): string | null {
  const eol = crlf || raw.includes("\r\n") ? "\r\n" : "\n";
  const block = formatFigureBlock(parts, eol) ?? (parts.model.kind === "drawing" ? null : formatFigureBlock({ ...parts, picture: null }, eol));
  if (block === null) return null;
  const bom = raw.startsWith(BOM_CHAR) ? BOM_CHAR : "";
  return carryFigureAttributes(raw.replace(BOM, ""), bom + block + eol);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What the view is given: Plotly, MathJax for drawing labels, the figure editor (without it the figure only shows) and the note files. */
interface FigureViewDeps { loadPlotly: PlotlyLoader; loadMath: MathLoader; loadEditor?: FigureEditorLoader; files?: NoteFilesPort }

class FigureView extends RawNodeView {
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
  private token = 0;
  /** The read of the block's `src`: its table, or the note that it was not found. */
  private source: { src: string; table: ChartTable | null; missing: string | null } | null = null;
  private reading: { src: string; done: Promise<void> } | null = null;
  /** The sized and aligned box around the plot and its fallback, inside the full-width `dom`. */
  private readonly box: HTMLElement;
  private readonly controls: MediaControls | null = null;

  constructor(node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly deps: FigureViewDeps) {
    super(node);
    this.plot = renderElement("div", { class: "qmd-chart-plot" });
    this.plot.hidden = true;
    passWheelToPage(this.plot);
    this.fallback = renderElement("div", { class: "qmd-chart-fallback" });
    this.exportNote = renderElement("div", { class: "qmd-chart-note", text: "No image for export yet" });
    this.box = renderElement("div", { class: "qmd-media-box" }, this.plot, this.fallback);
    this.dom = renderElement("div", { class: "qmd-chart qmd-figure" }, this.box);
    if (deps.loadEditor && view.editable) {
      this.controls = mountMediaControls(this.dom, {
        width: () => this.width(),
        align: () => this.align(),
        preview: (width, align) => this.showLayout(width, align),
        commit: (width, align) => {
          const pos = this.getPos();
          if (pos === undefined) return;
          this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, raw: setFigureAlign(setFigureWidth(this.raw, width), align) }));
        },
      });
    }
    if (deps.loadEditor) {
      this.dom.addEventListener("dblclick", () => { void this.open(); });
      registerNodeEditor(this.dom, () => { void this.open(); });
      this.dom.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || !this.isSelected()) return;
        event.preventDefault();
        void this.open();
      });
    }
    this.render();
  }

  /** Whether this figure is the selected node. */
  private isSelected(): boolean {
    const { selection } = this.view.state;
    return selection instanceof NodeSelection && selection.from === this.getPos();
  }

  private get raw(): string {
    return this.node.attrs.raw as string;
  }

  /** The opener's `width=`, or null. */
  private width(): string | null {
    return readAttrWidth(figureAttributes(this.raw));
  }

  /** The opener's `fig-align`, centre without one. */
  private align(): MediaAlign { return readAttrAlign(figureAttributes(this.raw)); }

  /** Sizes and places the figure's box; a drawn plot follows its new size. */
  private showLayout(width: string | null, align: MediaAlign): void {
    showMediaLayout(this.box, width, align);
    if (this.plotly && this.drawn && !this.plot.hidden) this.plotly.Plots.resize(this.plot);
  }

  stopEvent(event: Event): boolean { return this.controls?.isControlEvent(event) ?? false; }

  /** The block `raw` holds, or null when it is empty or unreadable. */
  private read(): FigureBlock | null {
    return this.raw.trim() === "" ? null : readFigureBlock(this.raw.replace(BOM, ""));
  }

  /** Opens the figure editor over the note, after asking when the block's LaTeX was edited by hand. */
  private async open(): Promise<void> {
    const { loadEditor } = this.deps;
    if (!loadEditor || !this.view.editable || this.opening || this.destroyed) return;
    const empty = this.raw.trim() === "";
    const block = this.read();
    if (!empty && !block) return;
    this.opening = true;
    try {
      if (block && block.picture !== null && block.handEdited && !(await askDialog("Edit figure", HAND_EDITED_QUESTION, "Edit figure"))) return;
      const src = block?.model.src;
      if (src !== undefined) await this.readSource(src);
      const editor = await loadEditor();
      if (this.destroyed) return;
      this.editor?.close();
      const source = src !== undefined && this.source?.src === src ? this.source : null;
      const { files } = this.deps;
      this.editor = editor.openFigureEditor({
        model: block?.model ?? null,
        loadPlotly: this.deps.loadPlotly,
        loadMath: this.deps.loadMath,
        ...(files ? { files } : {}),
        ...(source?.table ? { table: source.table } : {}),
        ...(src !== undefined && !source?.table ? { missing: source?.missing ?? `Data file ${src} not found` } : {}),
        done: (result) => this.finish(result),
      });
    } catch (error) {
      showToast(`Could not open the figure editor: ${errorText(error)}`, "error");
    } finally {
      this.opening = false;
    }
  }

  /** The editor closed without writing: a figure still empty (just inserted, no mode picked) goes, in the undo step of its insertion. */
  private removeIfEmpty(): void {
    if (this.destroyed || this.view.isDestroyed || this.raw.trim() !== "") return;
    const pos = this.getPos();
    if (pos === undefined || this.view.state.doc.nodeAt(pos)?.type !== this.node.type) return;
    // An appended transaction joins the history event before it instead of starting its own.
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize).setMeta("appendedTransaction", this.view.state.tr);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /** The editor's write: one commit of the whole block; null (the editor closed without writing) changes nothing but the removal of an empty figure. */
  private finish(result: FigureEditorResult | null): void {
    if (result === null) { this.editor = null; this.removeIfEmpty(); return; }
    if (this.destroyed || this.view.isDestroyed) return;
    const raw = this.buildRaw(result);
    const pos = this.getPos();
    if (raw === null || pos === undefined) return;
    // The commit may have rewritten the CSV, so a block with src reads it again.
    const reread = result.model.src !== undefined;
    if (reread) { this.source = null; this.reading = null; }
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, raw }));
    if (reread && this.reading === null) this.render();
  }

  /** Reads `src` once (a read already running for it is shared), then redraws. */
  private readSource(src: string): Promise<void> {
    if (this.source?.src === src) return Promise.resolve();
    if (this.reading?.src === src) return this.reading.done;
    const reading = {
      src,
      done: readChartSource(this.deps.files, src).then((result) => {
        if (this.destroyed || this.reading !== reading) return;
        this.reading = null;
        this.source = { src, ...result };
        this.render();
      }),
    };
    this.reading = reading;
    return reading.done;
  }

  /** The model's table: inline, or the one read from its `src`; null when that is not read. */
  private tableOf(model: FigureModel): ChartTable | null {
    const { src, data } = model;
    if (src === undefined) return data ?? null;
    return this.source?.src === src ? this.source.table : null;
  }

  /** The stored block of the editor's write; null, with a toast, when it does not fit. */
  private buildRaw(result: FigureEditorResult): string | null {
    const raw = figureRaw(this.raw, result, this.view.state.doc.attrs.eol === "\r\n");
    if (raw === null) showToast("This figure is too large to save.", "error");
    return raw;
  }

  /** The Plotly figure of the block in the theme the plot element shows. */
  private figureOf(block: FigureBlock, theme: ChartTheme): ChartFigure {
    return figurePlotly(block.model, this.tableOf(block.model), theme);
  }

  /** Shows the stored PNG, or a placeholder naming the figure's kind; `note` is shown under it. */
  private showFallback(block: FigureBlock | null, note: string | null): void {
    this.plot.hidden = true;
    this.fallback.hidden = false;
    const children: HTMLElement[] = [];
    if (block?.png) {
      children.push(renderElement("img", { class: "qmd-chart-image", src: block.png.dataUrl, alt: block.png.alt }));
    } else {
      children.push(renderElement("div", { class: "qmd-chart-placeholder", text: block ? figureKindLabel(block.model.kind) : "This figure could not be read." }));
    }
    if (note !== null) children.push(renderElement("div", { class: "qmd-chart-note", text: note }));
    this.fallback.replaceChildren(...children);
  }

  /** Shows a drawing: its stored SVG when the sanitizer keeps it, else the model drawn again once MathJax loads. */
  private showDrawing(block: FigureBlock): void {
    this.plot.hidden = true;
    this.fallback.hidden = false;
    const clean = block.svg === null ? null : sanitizeDrawingSvg(block.svg);
    const svg = clean === null ? null : parseSvg(clean);
    if (svg !== null) { this.fallback.replaceChildren(svg); return; }
    this.showFallback(block, null);
    const token = ++this.token;
    const drawing = block.model.drawing;
    if (drawing === undefined) return;
    void drawingSvg(drawing, this.deps.loadMath).then((markup) => {
      if (token !== this.token || this.destroyed) return;
      const redrawn = parseSvg(markup);
      if (redrawn !== null) this.fallback.replaceChildren(redrawn);
    }, () => undefined);
  }

  protected render(): void {
    const editable = this.deps.loadEditor !== undefined && this.view.editable;
    this.dom.classList.toggle("is-readonly", !editable);
    this.dom.title = editable ? "Double-click to edit figure" : "";
    const block = this.read();
    // Only a `.labshelf-figure` opener holds a width; an earlier drawing or chart block gets one once the editor rewrites it.
    const sizable = block !== null && figureAttributes(this.raw.replace(BOM, "")) !== null;
    if (this.controls) { this.controls.el.hidden = !sizable; this.controls.sync(); }
    this.showLayout(this.width(), this.align());
    // The note is in the DOM only while it applies.
    if (block !== null && block.png === null) this.dom.append(this.exportNote);
    else this.exportNote.remove();
    if (this.raw.trim() === "") {
      this.plot.hidden = true;
      this.fallback.hidden = false;
      this.fallback.replaceChildren(renderElement("div", { class: "qmd-chart-placeholder", text: "Empty figure" }));
      return;
    }
    if (!block) { this.showFallback(null, null); return; }
    if (block.model.kind === "drawing") { this.showDrawing(block); return; }
    const { src } = block.model;
    if (src !== undefined && this.source?.src !== src) {
      this.showFallback(block, null);
      void this.readSource(src);
      return;
    }
    if (src !== undefined && this.source?.missing) { this.showFallback(block, this.source.missing); return; }
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
    this.deps.loadPlotly().then(
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
    if (!block || block.model.kind === "drawing") return;
    const theme = readPlotTheme(this.plot);
    const figure = this.figureOf(block, chartTheme(theme));
    if (figure.data.length === 0) return;
    this.busy = true;
    this.dirty = false;
    this.drawnTheme = theme;
    this.plot.style.height = `${typeof figure.layout.height === "number" ? figure.layout.height : 450}px`;
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

  ignoreMutation(): boolean { return true; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.token++;
    this.editor?.close();
    this.editor = null;
    if (this.watchingTheme) unwatchTheme(this.themeListener);
    this.plotly?.purge(this.plot);
  }
}

/** A node view for the `figure` block; `loadPlotly` (default: the core Plotly) draws plots and data, `loadMath` the labels of a drawing redrawn from its model, `loadEditor` opens the figure editor on click or Enter, `files` reads and writes a large table's CSV. */
export function createFigureView(deps: { loadMath: MathLoader; loadPlotly?: PlotlyLoader; loadEditor?: FigureEditorLoader; files?: NoteFilesPort }): NodeViewConstructor {
  const full: FigureViewDeps = { ...deps, loadPlotly: deps.loadPlotly ?? loadCorePlotly };
  const construct: NodeViewConstructor = (node, view, getPos) => new FigureView(node, view, getPos, full);
  return construct;
}
