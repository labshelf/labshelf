// The edits of a sectioned HTML poster (contract `## Poster sections`): reflow, moving a section, resizing at a gap, the Poster Settings,
// orientation and new sections and figures. Each returns deck.html and theme.css, reflowed; the geometry goes through applyDeckEdit's resize.
import { isNumber } from "../guards/primitives.js";
import { escapeAttribute } from "./deckCharts.js";
import { blockTagAttributes } from "./deckCells.js";
import { freeDeckBlockId } from "./deckBlocks.js";
import { applyDeckEdit } from "./deckEdit.js";
import type { DeckBlock, DeckRange } from "./deckParse.js";
import { deckCanvasPx, type DeckSize } from "./deckSizes.js";
import { POSTER_MAX_COLUMNS, POSTER_SETTING_PROPERTIES, posterBlocks, posterBody, posterCanvas, posterTypeSizes, readPosterLayout, readPosterSettings, round2, type PosterLayout } from "./posterSections.js";
import { readThemeProperties, setThemeProperty } from "./themeCss.js";

export type PosterEditResult = { ok: true; html: string; theme: string } | { ok: false; error: string };

interface Splice { from: number; to: number; text: string }

const fail = (error: string): PosterEditResult => ({ ok: false, error });
const NOT_POSTER = "The deck is not an HTML poster.";
const NOT_SECTIONED = "The poster has no sections.";
const pxText = (value: number): string => `${round2(value)}px`;
const numberText = (value: number): string => String(round2(value));

function guarded(run: () => PosterEditResult): PosterEditResult {
  try {
    return run();
  } catch (error) {
    return fail(`The poster edit failed: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`);
  }
}

/** The theme with the five --poster-font-* variables of the size and the theme's type scale. */
function withFontVariables(theme: string, size: DeckSize, width: number, height: number): string {
  const sizes = posterTypeSizes(size, readPosterSettings(theme, width, height).typeScale);
  let result = theme;
  for (const [name, value] of Object.entries(sizes)) result = setThemeProperty(result, `--poster-font-${name}`, pxText(value));
  return result;
}

function reflowNow(html: string, theme: string): PosterEditResult {
  const canvas = posterCanvas(html);
  if (!canvas) return fail(NOT_POSTER);
  const layout = readPosterLayout(html, theme);
  if (!layout) return { ok: true, html, theme };
  let result = html;
  for (const box of [...(layout.header ? [layout.header] : []), ...layout.columns.flat()]) {
    const edit = applyDeckEdit(result, { kind: "resize", block: box.id, ...box.rect });
    if (!edit.ok) return edit;
    result = edit.html;
  }
  return { ok: true, html: result, theme: withFontVariables(theme, canvas.size, canvas.width, canvas.height) };
}

/** Writes the reflow geometry of every header and section block and the --poster-font-* variables; an unsectioned poster comes back unchanged. */
export function reflowPoster(html: string, theme: string): PosterEditResult {
  return guarded(() => reflowNow(html, theme));
}

/** The splice that sets an attribute of a block's start tag, adding it after the last of the poster attributes when missing. */
function attributeSplice(html: string, block: DeckBlock, name: string, value: string): Splice {
  const attributes = blockTagAttributes(html, block);
  const existing = attributes.find((attribute) => attribute.name === name);
  if (existing?.valueRange) return { ...existing.valueRange, text: value };
  if (existing) return { ...existing.range, text: `${name}="${value}"` };
  const anchor = [...attributes].reverse().find((attribute) => attribute.name.startsWith("data-poster") || attribute.name === "data-column" || attribute.name === "data-block");
  const at = anchor ? anchor.range.to : block.startTag.from + html.slice(block.startTag.from).search(/[\s/>]/);
  return { from: at, to: at, text: ` ${name}="${value}"` };
}

function applySplices(html: string, splices: Splice[]): string {
  let result = html;
  for (const splice of [...splices].sort((a, b) => b.from - a.from)) result = result.slice(0, splice.from) + splice.text + result.slice(splice.to);
  return result;
}

/** The block's line when nothing else stands on it (with its indentation and line break), else its range. */
function lineOf(html: string, range: DeckRange): { from: number; to: number; alone: boolean; indent: string } {
  const start = html.lastIndexOf("\n", range.from - 1) + 1;
  const endBreak = html.indexOf("\n", range.to);
  const end = endBreak === -1 ? html.length : endBreak + 1;
  const indent = html.slice(start, range.from);
  const alone = indent.trim() === "" && html.slice(range.to, end).trim() === "" && endBreak !== -1;
  return alone ? { from: start, to: end, alone, indent } : { ...range, alone, indent: "" };
}

/** Where and how a block's text goes before or after another block, as one insertion. */
function insertionAt(html: string, anchor: DeckRange, text: string, place: "before" | "after"): Splice {
  const line = lineOf(html, anchor);
  if (!line.alone) return place === "before" ? { from: anchor.from, to: anchor.from, text } : { from: anchor.to, to: anchor.to, text };
  const at = place === "before" ? line.from : line.to;
  return { from: at, to: at, text: `${line.indent}${text}\n` };
}

const sectionIds = (layout: PosterLayout): string[] => layout.columns.flat().map((box) => box.id);

/** Moves section `id` into `column` before its index-th section (clamped; past the end means after the column's last), then reflows. */
export function movePosterSection(html: string, theme: string, id: string, column: number, index: number): PosterEditResult {
  return guarded(() => {
    const canvas = posterCanvas(html);
    if (!canvas) return fail(NOT_POSTER);
    const layout = readPosterLayout(html, theme);
    if (!layout) return fail(NOT_SECTIONED);
    const infos = posterBlocks(html, canvas.model);
    const moved = infos.find((info) => info.role === "section" && info.block.id === id)?.block;
    if (!moved) return fail(`No section of the poster has the id "${String(id)}".`);
    if (!Number.isInteger(column) || column < 0 || column >= layout.columns.length) return fail(`The poster has no column ${String(column)}.`);
    const blockOf = (blockId: string): DeckBlock => infos.find((info) => info.block.id === blockId)!.block;
    const targets = layout.columns[column]!.filter((box) => box.id !== id);
    const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : 0, targets.length));
    const columnSplice = attributeSplice(html, moved, "data-column", String(column));
    const text = applySplices(html.slice(moved.range.from, moved.range.to), [{ ...columnSplice, from: columnSplice.from - moved.range.from, to: columnSplice.to - moved.range.from }]);
    const others = sectionIds(layout).filter((other) => other !== id);
    let insertion: Splice;
    if (at < targets.length) insertion = insertionAt(html, blockOf(targets[at]!.id).range, text, "before");
    else if (targets.length > 0) insertion = insertionAt(html, blockOf(targets[targets.length - 1]!.id).range, text, "after");
    else if (others.length > 0) insertion = insertionAt(html, blockOf(others[others.length - 1]!).range, text, "after");
    else return reflowNow(applySplices(html, [columnSplice]), theme);
    const removal = lineOf(html, moved.range);
    const p = insertion.from;
    const next = p >= removal.to
      ? html.slice(0, removal.from) + html.slice(removal.to, p) + insertion.text + html.slice(p)
      : html.slice(0, p) + insertion.text + html.slice(p, removal.from) + html.slice(removal.to);
    return reflowNow(next, theme);
  });
}

/** Moves `delta` px between the two sides of a gap: width between adjacent columns, or height between adjacent sections, each side kept at 10% at least. */
export function resizePosterGap(html: string, theme: string, gap: { kind: "column" | "section"; index: number; column: number }, delta: number): PosterEditResult {
  return guarded(() => {
    const layout = readPosterLayout(html, theme);
    if (!layout) return fail(posterCanvas(html) ? NOT_SECTIONED : NOT_POSTER);
    if (!gap || typeof delta !== "number" || !Number.isFinite(delta)) return fail("The gap and a finite delta in px are required.");
    if (gap.kind === "column") return resizeColumns(html, theme, layout, gap.index, delta);
    if (gap.kind === "section") return resizeSections(html, theme, layout, gap, delta);
    return fail("The gap kind must be column or section.");
  });
}

/** Moves `delta` of `sizes[i+1]` to `sizes[i]` keeping both at `floor` at least. */
function shift(sizes: number[], i: number, delta: number, floor: number): void {
  const clamped = Math.max(floor - sizes[i]!, Math.min(delta, sizes[i + 1]! - floor));
  sizes[i] = sizes[i]! + clamped;
  sizes[i + 1] = sizes[i + 1]! - clamped;
}

function resizeColumns(html: string, theme: string, layout: PosterLayout, index: number, delta: number): PosterEditResult {
  const { columns } = layout.settings;
  const count = columns.length;
  if (!Number.isInteger(index) || index < 0 || index >= count - 1) return fail(`The poster has no column gap ${String(index)}.`);
  const body = posterBody(layout.width, layout.height, layout.settings, layout.header !== null);
  const widths = body.columns.map((slot) => slot.width);
  const area = widths.reduce((sum, width) => sum + width, 0);
  if (!(area > 0)) return fail("The poster's columns have no width to share.");
  shift(widths, index, delta, area * 0.1);
  const ratios = widths.map((width) => round2((width / area) * count));
  ratios[index + 1] = round2(count - ratios.reduce((sum, ratio, i) => (i === index + 1 ? sum : sum + ratio), 0));
  return reflowNow(html, setThemeProperty(theme, POSTER_SETTING_PROPERTIES.columns, ratios.map(numberText).join(" ")));
}

function resizeSections(html: string, theme: string, layout: PosterLayout, gap: { index: number; column: number }, delta: number): PosterEditResult {
  const column = Number.isInteger(gap.column) ? layout.columns[gap.column] : undefined;
  if (!column || !Number.isInteger(gap.index) || gap.index < 0 || gap.index >= column.length - 1) return fail(`The poster has no section gap ${String(gap.index)} in column ${String(gap.column)}.`);
  const m = layout.settings.sectionMargin;
  const body = posterBody(layout.width, layout.height, layout.settings, layout.header !== null);
  const total = body.height - (column.length - 1) * m;
  if (!(total > 0)) return fail("The column has no height to share.");
  const sum = column.reduce((value, box) => value + box.weight, 0);
  const heights = column.map((box) => (total * box.weight) / sum);
  const j = gap.index;
  shift(heights, j, delta, total * 0.1);
  const pair = column[j]!.weight + column[j + 1]!.weight;
  const upper = Math.max(0.01, round2((pair * heights[j]!) / (heights[j]! + heights[j + 1]!)));
  const lower = Math.max(0.01, round2(pair - upper));
  const canvas = posterCanvas(html)!;
  const blockOf = (id: string): DeckBlock => canvas.model.slides[0]!.blocks.find((block) => block.id === id)!;
  const splices = [attributeSplice(html, blockOf(column[j]!.id), "data-weight", numberText(upper)), attributeSplice(html, blockOf(column[j + 1]!.id), "data-weight", numberText(lower))];
  return reflowNow(applySplices(html, splices), theme);
}

type PosterSettingsChange = { size?: import("./deckSizes.js").DeckSize; sectionMargin?: number; contentMargin?: number; headerHeight?: number; columns?: number[]; typeScale?: number };

function settingsProblem(change: PosterSettingsChange): string | null {
  for (const key of ["sectionMargin", "contentMargin"] as const) {
    if (change[key] !== undefined && !(isNumber(change[key]) && change[key] >= 0)) return `The ${key === "sectionMargin" ? "section" : "content"} margin must be a finite number of px, 0 or more.`;
  }
  if (change.headerHeight !== undefined && !(isNumber(change.headerHeight) && change.headerHeight > 0)) return "The header height must be a finite number of px above 0.";
  if (change.columns !== undefined) {
    const { columns } = change;
    if (!Array.isArray(columns) || columns.length < 1 || columns.length > POSTER_MAX_COLUMNS || !columns.every((ratio) => isNumber(ratio) && round2(ratio) > 0)) {
      return `The columns must be 1 to ${POSTER_MAX_COLUMNS} positive ratios.`;
    }
  }
  if (change.typeScale !== undefined && !(isNumber(change.typeScale) && change.typeScale >= 0.5 && change.typeScale <= 2)) return "The type scale must be between 0.5 and 2.";
  return null;
}

/** Writes the given Poster Settings to the theme (and a size to data-deck-size, blocks not scaled), the --poster-font-* variables, then reflows. */
export function setPosterSettings(html: string, theme: string, change: PosterSettingsChange): PosterEditResult {
  return guarded(() => {
    if (!posterCanvas(html)) return fail(NOT_POSTER);
    if (!change || typeof change !== "object") return fail("The settings change must be an object.");
    const problem = settingsProblem(change);
    if (problem) return fail(problem);
    let next = html;
    if (change.size !== undefined) {
      const sized = applyDeckEdit(html, { kind: "setSize", size: change.size, scale: false });
      if (!sized.ok) return sized;
      next = sized.html;
    }
    let nextTheme = theme;
    const set = (name: string, value: string): void => {
      nextTheme = setThemeProperty(nextTheme, name, value);
    };
    if (change.columns !== undefined) set(POSTER_SETTING_PROPERTIES.columns, change.columns.map(numberText).join(" "));
    if (change.sectionMargin !== undefined) set(POSTER_SETTING_PROPERTIES.sectionMargin, pxText(change.sectionMargin));
    if (change.contentMargin !== undefined) set(POSTER_SETTING_PROPERTIES.contentMargin, pxText(change.contentMargin));
    if (change.headerHeight !== undefined) set(POSTER_SETTING_PROPERTIES.headerHeight, pxText(change.headerHeight));
    if (change.typeScale !== undefined) set(POSTER_SETTING_PROPERTIES.typeScale, numberText(change.typeScale));
    const canvas = posterCanvas(next)!;
    return reflowNow(next, withFontVariables(nextTheme, canvas.size, canvas.width, canvas.height));
  });
}

/** Swaps the poster's width and height (a preset becomes its other orientation), scales a set header height by newH / oldH, and reflows. */
export function switchPosterOrientation(html: string, theme: string): PosterEditResult {
  return guarded(() => {
    const canvas = posterCanvas(html);
    if (!canvas) return fail(NOT_POSTER);
    const size: DeckSize = { w: canvas.size.h, h: canvas.size.w, unit: canvas.size.unit };
    const sized = applyDeckEdit(html, { kind: "setSize", size, scale: false });
    if (!sized.ok) return sized;
    let nextTheme = theme;
    const headerSet = readThemeProperties(theme).some((property) => property.name === POSTER_SETTING_PROPERTIES.headerHeight);
    if (headerSet) {
      const after = deckCanvasPx(size);
      const header = readPosterSettings(theme, canvas.width, canvas.height).headerHeight;
      nextTheme = setThemeProperty(theme, POSTER_SETTING_PROPERTIES.headerHeight, pxText((header * after.height) / canvas.height));
    }
    return reflowNow(sized.html, nextTheme);
  });
}

/** Appends a section with an h2 title and a paragraph to `column` (after its last section, the last section, or at the end of the slide), then reflows. */
export function addPosterSection(html: string, theme: string, column: number, title = "New section"): PosterEditResult {
  return guarded(() => {
    const canvas = posterCanvas(html);
    if (!canvas) return fail(NOT_POSTER);
    const slide = canvas.model.slides[0];
    if (!slide) return fail("The poster has no slide.");
    const count = readPosterSettings(theme, canvas.width, canvas.height).columns.length;
    if (!Number.isInteger(column) || column < 0 || column >= count) return fail(`The poster has no column ${String(column)}.`);
    if (typeof title !== "string") return fail("The section title must be a string.");
    const id = freeDeckBlockId(canvas.model, "section");
    const text = `<div data-block="${id}" data-poster="section" data-column="${column}"><h2>${escapeAttribute(title)}</h2><p>Text</p></div>`;
    const layout = readPosterLayout(html, theme);
    const blockOf = (blockId: string): DeckBlock => slide.blocks.find((block) => block.id === blockId)!;
    const inColumn = layout?.columns[column] ?? [];
    const sections = posterBlocks(html, canvas.model).filter((info) => info.role === "section");
    let insertion: Splice;
    if (inColumn.length > 0) insertion = insertionAt(html, blockOf(inColumn[inColumn.length - 1]!.id).range, text, "after");
    else if (sections.length > 0) insertion = insertionAt(html, sections[sections.length - 1]!.block.range, text, "after");
    else {
      const at = slide.notes ? slide.notes.range.from : slide.contentRange.to;
      insertion = { from: at, to: at, text: html[at - 1] === "\n" ? `${text}\n` : `\n${text}` };
    }
    return reflowNow(applySplices(html, [insertion]), theme);
  });
}

/** Appends a figure with its img and an attached figcaption at the end of a section's content, then reflows. */
export function addPosterFigure(html: string, theme: string, section: string, src: string, caption = "Figure caption"): PosterEditResult {
  return guarded(() => {
    const canvas = posterCanvas(html);
    if (!canvas) return fail(NOT_POSTER);
    const block = posterBlocks(html, canvas.model).find((info) => info.role === "section" && info.block.id === section)?.block;
    if (!block) return fail(`No section of the poster has the id "${String(section)}".`);
    if (typeof src !== "string" || typeof caption !== "string") return fail("The figure source and caption must be strings.");
    const close = html.lastIndexOf("</", block.range.to);
    if (close <= block.startTag.to) return fail(`The section "${section}" has no closing tag.`);
    const figure = `<figure><img src="${escapeAttribute(src)}" alt=""><figcaption>${escapeAttribute(caption)}</figcaption></figure>`;
    return reflowNow(applySplices(html, [{ from: close, to: close, text: figure }]), theme);
  });
}
