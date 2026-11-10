// The deck workspace's edits: inserting text, image, equation, chart and shape blocks, editing a chart through the figure editor, duplicating, deleting, ordering and aligning the
// selection (duplicate and align through arrange.ts), and new slides from a layout; each one undo step through the bare editor.
import { applyDeckEdit } from "../../../deckEdit.js";
import { equationBlockHtml, freeDeckBlockId, imageBlockHtml, reorderDeckBlock, textBlockHtml } from "../../../deckBlocks.js";
import { deckSlideLayoutHtml, type DeckSlideLayout } from "../../../deckSlideLayouts.js";
import type { DeckBlock, DeckRect } from "../../../deckParse.js";
import { deckCanvasPx } from "../../../deckSizes.js";
import { findDeckBlock, shapeBlockHtml } from "../../../deckStyle.js";
import { chartBlockHtml, deckChartLabel, readDeckChart, setDeckChart, type DeckChart } from "../../../deckCharts.js";
import { readFigureModel, type FigureModel } from "../../../../qmd/chart/index.js";
import type { FigureEditorResult } from "../../../../qmd/dom/figureEditor/index.js";
import { showToast } from "../../../../ui/dom/index.js";
import { alignBlocks, duplicateBlocks } from "./arrange.js";
import type { BlockInsertKind, ShellContext } from "./types.js";

export const canvasOf = (ctx: ShellContext): { width: number; height: number } => (ctx.view.model?.size ? deckCanvasPx(ctx.view.model.size) : { width: 1920, height: 1080 });

/** The one selected block, or undefined. */
export function selectedBlock(ctx: ShellContext): DeckBlock | undefined {
  const { model, slide, blocks } = ctx.view;
  return blocks.length === 1 ? model?.slides[slide]?.blocks.find((block) => block.id === blocks[0]) : undefined;
}

/** A rect of the canvas's share `w` × `h`, centred. */
function centred(ctx: ShellContext, w: number, h: number): DeckRect {
  const canvas = canvasOf(ctx);
  const width = Math.round(canvas.width * w);
  const height = Math.round(canvas.height * h);
  return { left: Math.round((canvas.width - width) / 2), top: Math.round((canvas.height - height) / 2), width, height };
}

/** Opens the figure editor on `model` (null: a new data or plot figure, its table kept inline) and gives `done` each chart it reports (null for a write without a picture or a close). */
async function openChartEditor(model: FigureModel | null, done: (chart: DeckChart | null) => void): Promise<void> {
  try {
    // Loaded only when a chart is inserted or edited, so the figure editor and Plotly loader stay out of the deck editor chunk.
    const { loadCoreMath, loadCorePlotly, loadFigureEditor } = await import("../../../../qmd/dom/index.js");
    const editor = await loadFigureEditor();
    editor.openFigureEditor({
      model, place: "Deck", kinds: ["data", "plot"], loadPlotly: loadCorePlotly, loadMath: loadCoreMath,
      done: (result: FigureEditorResult | null) => {
        if (!result?.png) return done(null);
        const text = JSON.stringify(result.model);
        done({ model: text, png: result.png.dataUrl, alt: deckChartLabel(text) });
      },
    });
  } catch (error) {
    showToast(`Could not open the chart editor: ${error instanceof Error ? error.message : String(error)}`, "error");
    done(null);
  }
}

/** Builds the html of a chart block, or shows why it cannot be written and gives undefined. */
function chartHtml(id: string, rect: DeckRect, chart: DeckChart): string | undefined {
  try {
    return chartBlockHtml(id, rect, chart);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  }
}

/** Reopens the figure editor on a chart block's model; Done writes one "Edit chart" step. An unreadable model only shows a toast. */
export function editChart(ctx: ShellContext, id: string): void {
  const block = findDeckBlock(ctx.view.model, id);
  const text = block && readDeckChart(ctx.view.html, block)?.model;
  let model: FigureModel | null = null;
  try { model = text ? readFigureModel(JSON.parse(text)) : null; } catch { model = null; }
  if (!model) { showToast("This chart cannot be edited", "error"); return; }
  void openChartEditor(model, (chart) => { if (chart) writeChart(ctx, id, chart); });
}

/** One "Edit chart" step that replaces the chart of block `id`; a chart that cannot be written only shows a toast. */
function writeChart(ctx: ShellContext, id: string, chart: DeckChart): void {
  const written = setDeckChart(ctx.view.html, id, chart);
  if (!written.ok) { showToast(written.error, "error"); return; }
  ctx.edit([(html) => applyDeckEdit(html, { kind: "setChart", block: id, chart })], "Edit chart", [id]);
}

/**
 * Opens the figure editor on a new chart: its first write with a picture adds the block as one "Insert block" step and selects it,
 * and every later write of the same session (Apply, then Done) updates that block as an "Edit chart" step.
 */
function insertChart(ctx: ShellContext): void {
  let inserted: string | null = null;
  void openChartEditor(null, (chart) => {
    if (!chart) return;
    if (inserted) return writeChart(ctx, inserted, chart);
    const id = freeDeckBlockId(ctx.view.model, ID_PREFIX.chart);
    const html = chartHtml(id, centred(ctx, 0.4, 0.4), chart);
    if (!html) return;
    inserted = id;
    ctx.edit([(current) => applyDeckEdit(current, { kind: "addBlock", slide: ctx.view.slide, html })], "Insert block", [id]);
  });
}

async function blockHtml(ctx: ShellContext, kind: Exclude<BlockInsertKind, "chart">, id: string): Promise<string | undefined> {
  if (kind === "text") return textBlockHtml(id, centred(ctx, 0.4, 0.12), "Text");
  if (kind === "equation") return equationBlockHtml(id, centred(ctx, 0.3, 0.14), "E = mc^2");
  if (kind === "image") {
    const src = await ctx.options.pickImage?.();
    return src ? imageBlockHtml(id, centred(ctx, 0.4, 0.4), src) : undefined;
  }
  const square = Math.round(Math.min(canvasOf(ctx).width, canvasOf(ctx).height) / 4);
  const rect = centred(ctx, square / canvasOf(ctx).width, kind === "line" ? 8 / canvasOf(ctx).height : square / canvasOf(ctx).height);
  return shapeBlockHtml(id, kind, rect);
}

const ID_PREFIX: Record<BlockInsertKind, string> = { text: "text", image: "image", equation: "equation", chart: "chart", rect: "shape", ellipse: "shape", line: "shape" };

/** Adds a block of `kind` in the middle of the current slide and selects it. */
export async function insertBlock(ctx: ShellContext, kind: BlockInsertKind): Promise<void> {
  if (kind === "chart") return insertChart(ctx);
  const id = freeDeckBlockId(ctx.view.model, ID_PREFIX[kind]);
  const html = await blockHtml(ctx, kind, id);
  if (html) ctx.edit([(current) => applyDeckEdit(current, { kind: "addBlock", slide: ctx.view.slide, html })], "Insert block", [id]);
}

/** Duplicates the selected blocks 24 px off as one step (arrange.ts). */
export const duplicateSelected = (ctx: ShellContext): void => duplicateBlocks(ctx);

export function deleteSelected(ctx: ShellContext): void {
  const ids = ctx.view.blocks;
  ctx.edit(ids.map((id) => (html: string) => applyDeckEdit(html, { kind: "deleteBlock", block: id })), "Delete block", []);
}

export function orderSelected(ctx: ShellContext, place: "front" | "back"): void {
  const block = selectedBlock(ctx);
  if (block) ctx.edit([(html) => reorderDeckBlock(html, block.id, place)], place === "front" ? "Bring to front" : "Send to back", [block.id]);
}

export type AlignSide = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Aligns the one selected block on the slide, or several to the selection (arrange.ts). */
export const alignSelected = (ctx: ShellContext, side: AlignSide): void => alignBlocks(ctx, side);

/** Sets the block's rect from panel values in canvas px. */
export function placeBlock(ctx: ShellContext, id: string, rect: DeckRect): void {
  if (Object.values(rect).every(Number.isFinite)) ctx.edit([(html) => applyDeckEdit(html, { kind: "resize", block: id, ...rect })], "Move block", [id]);
}

/** Adds a slide of `layout` after the current one, its blocks placed by the theme's grid cells, and shows it. */
export function newSlide(ctx: ShellContext, layout: DeckSlideLayout): void {
  const at = ctx.view.slide + 1;
  const section = deckSlideLayoutHtml(ctx.view.model, layout, ctx.view.theme, canvasOf(ctx));
  ctx.edit([(html) => applyDeckEdit(html, { kind: "addSlide", at, html: section })], "Add slide");
  ctx.editor.selectSlide(at);
}
