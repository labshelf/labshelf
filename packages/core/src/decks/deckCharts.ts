// The chart block of an HTML deck: a block whose data-chart holds the figure editor's model as JSON text and whose img shows the
// chart's static picture (a PNG or SVG data URL). Pure: written, read and replaced as text splices; nothing here imports qmd.
import type { DeckEditResult } from "./deckEdit.js";
import { parseDeck, type DeckBlock, type DeckRect } from "./deckParse.js";
import { findDeckBlock, px } from "./deckStyle.js";
import { tokenizeDeckHtml, type DeckAttribute, type DeckRange } from "./deckTokens.js";

export interface DeckChart { model: string; png: string; alt: string }

/** The longest model text a chart block keeps, in characters. */
export const DECK_CHART_MODEL_LIMIT = 131072;

const TOO_LARGE = "Chart data is too large (keep it under 128 KB)";
const BAD_IMAGE = "The chart picture must be a PNG or SVG data URL.";
const IMAGE_PREFIXES = ["data:image/png;base64,", "data:image/svg+xml"];

/** Escapes & < > " for an attribute value or text. */
export const escapeAttribute = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Why a chart cannot be written, or null. */
function chartProblem(chart: DeckChart): string | null {
  if (typeof chart.model !== "string" || chart.model.length > DECK_CHART_MODEL_LIMIT) return TOO_LARGE;
  if (typeof chart.png !== "string" || !IMAGE_PREFIXES.some((prefix) => chart.png.startsWith(prefix))) return BAD_IMAGE;
  return null;
}

/** A chart block: the block open tag with data-chart, and an img with the picture fitting the block. Throws for a refused chart. */
export function chartBlockHtml(id: string, rect: DeckRect, chart: DeckChart): string {
  const problem = chartProblem(chart);
  if (problem) throw new Error(problem);
  const style = `left: ${px(rect.left)}; top: ${px(rect.top)}; width: ${px(rect.width)}; height: ${px(rect.height)};`;
  return `<div data-block="${id}" data-chart="${escapeAttribute(chart.model)}" style="${style}">`
    + `<img src="${escapeAttribute(chart.png)}" alt="${escapeAttribute(chart.alt)}" style="width: 100%; height: 100%; object-fit: contain;"></div>`;
}

interface ChartParts { chart: DeckAttribute; img: { attributes: DeckAttribute[]; range: DeckRange } | null; offset: number }

/** The block's data-chart attribute and its first img's attributes, with ranges relative to `offset`; null without data-chart. */
function chartParts(html: string, range: DeckRange): ChartParts | null {
  const { tokens } = tokenizeDeckHtml(html.slice(range.from, range.to));
  const open = tokens.find((token) => token.kind === "start");
  const chart = open?.kind === "start" ? open.attributes.find((attribute) => attribute.name === "data-chart") : undefined;
  if (!chart) return null;
  const img = tokens.find((token) => token.kind === "start" && token.name === "img");
  return { chart, img: img?.kind === "start" ? { attributes: img.attributes, range: img.range } : null, offset: range.from };
}

/** The unescaped data-chart text and the src of the block's first img (null when none); null when the block has no data-chart. */
export function readDeckChart(html: string, block: Pick<DeckBlock, "range">): { model: string; png: string | null } | null {
  const parts = chartParts(html, block.range);
  if (!parts) return null;
  return { model: parts.chart.value ?? "", png: parts.img?.attributes.find((attribute) => attribute.name === "src")?.value ?? null };
}

interface Splice { from: number; to: number; text: string }

/** The splice that sets an attribute's value, or adds the attribute after `after` when it is missing. */
function valueSplice(attribute: DeckAttribute | undefined, name: string, value: string, after: number, offset: number): Splice {
  const escaped = escapeAttribute(value);
  if (!attribute) return { from: offset + after, to: offset + after, text: ` ${name}="${escaped}"` };
  if (attribute.valueRange) return { from: offset + attribute.valueRange.from, to: offset + attribute.valueRange.to, text: escaped };
  return { from: offset + attribute.range.from, to: offset + attribute.range.to, text: `${name}="${escaped}"` };
}

/** The deck with the chart block's model, picture and alt replaced, every other byte kept; never throws. */
export function setDeckChart(html: string, block: string, chart: DeckChart): DeckEditResult {
  const problem = chartProblem(chart);
  if (problem) return { ok: false, error: problem };
  const found = findDeckBlock(parseDeck(html).model, block);
  if (!found) return { ok: false, error: `No block has the id "${String(block)}".` };
  const parts = chartParts(html, found.range);
  if (!parts) return { ok: false, error: `The block "${block}" holds no chart.` };
  const splices: Splice[] = [valueSplice(parts.chart, "data-chart", chart.model, 0, parts.offset)];
  if (parts.img) {
    const src = parts.img.attributes.find((attribute) => attribute.name === "src");
    const alt = parts.img.attributes.find((attribute) => attribute.name === "alt");
    // A missing src goes right after "<img", a missing alt after the src; ranges are relative to the block start.
    const afterName = parts.img.range.from + "<img".length;
    splices.push(valueSplice(src, "src", chart.png, afterName, parts.offset));
    splices.push(valueSplice(alt, "alt", chart.alt, src?.range.to ?? afterName, parts.offset));
  }
  let result = html;
  for (const splice of splices.sort((a, b) => b.from - a.from)) result = result.slice(0, splice.from) + splice.text + result.slice(splice.to);
  return { ok: true, html: result };
}

/** The editor's name of a chart block: its model's title when that is a non-empty string, else "Chart". */
export function deckChartLabel(model: string): string {
  try {
    const parsed: unknown = JSON.parse(model);
    const title = parsed && typeof parsed === "object" ? (parsed as { title?: unknown }).title : undefined;
    return typeof title === "string" && title.length > 0 ? title : "Chart";
  } catch {
    return "Chart";
  }
}

/** Whether a data-chart text is JSON of an object whose v is 1, the model the figure editor reads. */
export function isDeckChartModel(model: string): boolean {
  try {
    const parsed: unknown = JSON.parse(model);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { v?: unknown }).v === 1;
  } catch {
    return false;
  }
}
