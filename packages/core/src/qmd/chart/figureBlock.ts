// The stored figure block: a labshelf-figure div holding an optional guarded picture (TikZ for a drawing, pgfplots for a plot
// or data figure) around the PNG line, a drawing's SVG, then the model. Also reads the earlier labshelf-drawing and
// labshelf-chart divs as figures, which are written back in the new form; the chart block (an optional guarded pgfplots picture
// around the optional PNG line, then the model) is still read and written as itself, under the same 256 KB cap.
// CONTRACT: documents/contracts/qmd-items.md#figures
// CONTRACT: documents/contracts/qmd-items.md#charts
import { CLOSE_DIV, FENCE, FI, GUARD_CLOSE, LATEX_FENCE, escapeAlt, openDiv, readDrawingBlock, sha256Hex, unescapeAlt, utf8Bytes } from '../../drawing/index.js';
import { carryFigureAttributes, figureSource } from '../editor/index.js';
import { figureOfChart, figureOfDrawing, readFigureModel, type FigureModel } from './figureModel.js';
import { readChartModel, type ChartModel } from './model.js';

export interface FigurePng { dataUrl: string; widthCm: number; alt: string }

/** A read figure: the picture inside the guard (null without one), the drawing's SVG, and whether the block was edited by hand. */
export interface FigureBlock { model: FigureModel; png: FigurePng | null; picture: string | null; svg: string | null; handEdited: boolean }

export interface ChartBlock { model: ChartModel; png: { dataUrl: string; widthCm: number; alt: string } | null; pgf: string | null; handEdited: boolean }

const BLOCK_BYTES = 262144;
const BOM_CHAR = '\ufeff';
const MODEL_FENCE = '```{=labshelf-figure}';
const SVG_FENCE = '```{=labshelf-svg}';
/** The figure div's opener; besides `source=` it may hold other attributes, such as `width=60%` (see `editor/mediaWidth.ts`). */
const OPENER = /^::: \{(\.labshelf-figure(?=[\s}])[^{}]*)\}$/;
const CHART_MODEL_FENCE = '```{=labshelf-chart}';
const CHART_GUARD_OPEN = '\\makeatletter\\@ifundefined{pgfplotsset}{\\iftrue}{';
const CHART_OPENER = /^::: \{\.labshelf-chart source=([^\s{}]+)\}$/;
const IMAGE = /^!\[\]\((data:image\/png;base64,[A-Za-z0-9+/]*={0,2})\)\{width=(\d+(?:\.\d+)?)cm fig-alt="((?:[^"\\]|\\.)*)"\}$/;

/** The guard's opening for a figure kind: TikZ for a drawing, pgfplots for the rest. */
const guardOpen = (kind: FigureModel['kind']): string => `\\makeatletter\\@ifundefined{${kind === 'drawing' ? 'tikzpicture' : 'pgfplotsset'}}{\\iftrue}{`;
const GUARDS = [guardOpen('drawing'), guardOpen('plot')];

const sourceHash = (text: string): string => sha256Hex(text).slice(0, 12);

/** The picture inside a guard fence, or null when the fence is not a guard. */
function unguard(guard: string): string | null {
  const open = GUARDS.find((g) => guard.startsWith(g));
  return open !== undefined && guard.endsWith(GUARD_CLOSE) ? guard.slice(open.length, guard.length - GUARD_CLOSE.length) : null;
}

/** Reads a chart block: exactly one labshelf-chart div with its parts in the order of the contract (\n or \r\n, blank lines between parts); null for anything else, an invalid model or a block over the cap. */
export function readChartBlock(raw: string): ChartBlock | null {
  if (utf8Bytes(raw) > BLOCK_BYTES) { return null; }
  const div = openDiv(raw, CHART_OPENER);
  if (!div) { return null; }
  const { opener, parts } = div;
  let pgf: string | null = null;
  if (parts.peek() === LATEX_FENCE) {
    const guard = parts.fence(LATEX_FENCE);
    if (guard === null || !guard.startsWith(CHART_GUARD_OPEN) || !guard.endsWith(GUARD_CLOSE)) { return null; }
    pgf = guard.slice(CHART_GUARD_OPEN.length, guard.length - GUARD_CLOSE.length);
  }
  const image = IMAGE.exec(parts.peek() ?? "");
  if (image) { parts.line(); }
  if (pgf !== null && parts.fence(LATEX_FENCE) !== FI) { return null; }
  const json = parts.fence(CHART_MODEL_FENCE);
  if (json === null || json.includes("\n") || !parts.done()) { return null; }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const model = readChartModel(value);
  if (!model) { return null; }
  const png = image ? { dataUrl: image[1]!, widthCm: Number(image[2]), alt: unescapeAlt(image[3]!) } : null;
  return { model, png, pgf, handEdited: opener[1] !== sourceHash(pgf ?? json) };
}

/** Writes the chart block with the given line ending (\n by default): the model in canonical form, source from the pgfplots part when present, else from the model JSON; null when the model is invalid, a part would break the block, or it exceeds 262144 UTF-8 bytes. */
export function formatChartBlock(block: Omit<ChartBlock, 'handEdited'>, eol: '\n' | '\r\n' = "\n"): string | null {
  const model = readChartModel(block.model);
  if (!model) { return null; }
  const json = JSON.stringify(model);
  const pgf = block.pgf === null ? null : block.pgf.replace(/\r\n?/g, "\n");
  if (pgf !== null && pgf.split("\n").includes(FENCE)) { return null; }
  const parts: string[][] = [];
  if (pgf !== null) { parts.push([LATEX_FENCE, `${CHART_GUARD_OPEN}${pgf}${GUARD_CLOSE}`, FENCE]); }
  if (block.png !== null) {
    const { dataUrl, widthCm, alt } = block.png;
    if (!Number.isFinite(widthCm) || widthCm <= 0) { return null; }
    const line = `![](${dataUrl}){width=${widthCm}cm fig-alt="${escapeAlt(alt)}"}`;
    if (!IMAGE.test(line)) { return null; }
    parts.push([line]);
  }
  if (pgf !== null) { parts.push([LATEX_FENCE, FI, FENCE]); }
  parts.push([CHART_MODEL_FENCE, json, FENCE]);
  const text = [
    `::: {.labshelf-chart source=${sourceHash(pgf ?? json)}}`,
    parts.map((p) => p.join("\n")).join("\n\n"),
    CLOSE_DIV,
  ].join("\n");
  const out = eol === "\n" ? text : text.replace(/\n/g, eol);
  return utf8Bytes(out) > BLOCK_BYTES ? null : out;
}

/** The id a drawing block without one gets: the first 8 characters of its source hash. */
const drawingId = (source: string): string => (/^[0-9a-f]{8}/.test(source) ? source.slice(0, 8) : sha256Hex(source).slice(0, 8));

/** Reads an earlier drawing or chart block as a figure; null for anything else. */
function readEarlier(raw: string): FigureBlock | null {
  const drawing = readDrawingBlock(raw);
  if (drawing) {
    const png = { dataUrl: drawing.png, widthCm: 0, alt: drawing.alt };
    return { model: figureOfDrawing(drawing.model, drawingId(drawing.source)), png, picture: drawing.tikz, svg: drawing.svg, handEdited: drawing.handEdited };
  }
  const chart = readChartBlock(raw);
  return chart && { model: figureOfChart(chart.model), png: chart.png, picture: chart.pgf, svg: null, handEdited: chart.handEdited };
}

/** Reads a figure block (or an earlier drawing or chart block); null for anything else, an invalid model or a block over the cap. */
export function readFigureBlock(raw: string): FigureBlock | null {
  if (utf8Bytes(raw) > BLOCK_BYTES) { return null; }
  const div = openDiv(raw, OPENER);
  if (!div) { return readEarlier(raw); }
  const { opener, parts } = div;
  if (figureSource(opener[1]!) === null) { return null; }
  let picture: string | null = null;
  if (parts.peek() === LATEX_FENCE) {
    picture = unguard(parts.fence(LATEX_FENCE) ?? '');
    if (picture === null) { return null; }
  }
  const image = IMAGE.exec(parts.peek() ?? '');
  if (image) { parts.line(); }
  if (picture !== null && parts.fence(LATEX_FENCE) !== FI) { return null; }
  const svg = parts.peek() === SVG_FENCE ? parts.fence(SVG_FENCE) : null;
  const json = parts.fence(MODEL_FENCE);
  if (json === null || json.includes('\n') || !parts.done()) { return null; }
  let value: unknown;
  try { value = JSON.parse(json); } catch { return null; }
  const model = readFigureModel(value);
  if (!model || (model.kind === 'drawing') !== (svg !== null)) { return null; }
  const png = image ? { dataUrl: image[1]!, widthCm: Number(image[2]), alt: unescapeAlt(image[3]!) } : null;
  return { model, png, picture, svg, handEdited: figureSource(opener[1]!) !== sourceHash(picture ?? json) };
}

/** The PNG line, or null when its parts would not read back. */
function pngLine(png: FigurePng): string | null {
  if (!Number.isFinite(png.widthCm) || png.widthCm <= 0) { return null; }
  const line = `![](${png.dataUrl}){width=${png.widthCm}cm fig-alt="${escapeAlt(png.alt)}"}`;
  return IMAGE.test(line) ? line : null;
}

/** Writes the figure block with the given line ending; null when the model is invalid, a part would break the block, a drawing lacks its PNG or SVG, or it passes 262144 UTF-8 bytes. */
export function formatFigureBlock(block: Omit<FigureBlock, 'handEdited'>, eol: '\n' | '\r\n' = '\n'): string | null {
  const model = readFigureModel(block.model);
  if (!model) { return null; }
  const drawing = model.kind === 'drawing';
  if (drawing && (block.png === null || block.svg === null)) { return null; }
  const json = JSON.stringify(model);
  const picture = block.picture === null ? null : block.picture.replace(/\r\n?/g, '\n');
  if (picture !== null && picture.split('\n').includes(FENCE)) { return null; }
  const parts: string[][] = [];
  if (picture !== null) { parts.push([LATEX_FENCE, `${guardOpen(model.kind)}${picture}${GUARD_CLOSE}`, FENCE]); }
  if (block.png !== null) {
    const line = pngLine(block.png);
    if (line === null) { return null; }
    parts.push([line]);
  }
  if (picture !== null) { parts.push([LATEX_FENCE, FI, FENCE]); }
  if (drawing) { parts.push([SVG_FENCE, block.svg!.replace(/\r\n?|\n/g, ' '), FENCE]); }
  parts.push([MODEL_FENCE, json, FENCE]);
  const text = [`::: {.labshelf-figure source=${sourceHash(picture ?? json)}}`, parts.map((p) => p.join('\n')).join('\n\n'), CLOSE_DIV].join('\n');
  const out = eol === '\n' ? text : text.replace(/\n/g, eol);
  return utf8Bytes(out) > BLOCK_BYTES ? null : out;
}

/**
 * The block that replaces `raw` with `parts`, in the note's line ending (CRLF when `crlf` or `raw` has it), keeping a byte order
 * mark and the opener's other attributes; a picture that would push it over the cap is left out (a plot or data figure is then
 * saved image-only). Null when it still does not fit.
 */
export function figureRaw(raw: string, parts: Omit<FigureBlock, 'handEdited'>, crlf: boolean): string | null {
  const eol = crlf || raw.includes('\r\n') ? '\r\n' : '\n';
  const block = formatFigureBlock(parts, eol) ?? (parts.model.kind === 'drawing' ? null : formatFigureBlock({ ...parts, picture: null }, eol));
  if (block === null) return null;
  const bom = raw.startsWith(BOM_CHAR) ? BOM_CHAR : '';
  return carryFigureAttributes(raw.startsWith(BOM_CHAR) ? raw.slice(1) : raw, bom + block + eol);
}
