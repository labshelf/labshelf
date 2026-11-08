// Smart sections of an HTML poster (contract `## Poster sections`): the header band and the sectioned columns read from the blocks'
// data-poster, data-column and data-weight, the Poster Settings read from theme.css, and the reflow geometry in canvas px. Pure; nothing is written here.
import { blockTagAttributes } from "./deckCells.js";
import { parseDeck, type DeckBlock, type DeckModel, type DeckRect } from "./deckParse.js";
import { deckCanvasPx, type DeckSize } from "./deckSizes.js";
import { smallTextThresholdPt } from "./posterMeasure.js";
import { readThemeProperties } from "./themeCss.js";

export interface PosterSettings { columns: number[]; sectionMargin: number; contentMargin: number; headerHeight: number; typeScale: number }

export interface PosterBox { id: string; role: "header" | "section"; column: number; weight: number; rect: import("./deckParse.js").DeckRect }

export interface PosterGap { kind: "column" | "section"; index: number; column: number; rect: import("./deckParse.js").DeckRect }

export interface PosterLayout { width: number; height: number; settings: PosterSettings; header: PosterBox | null; columns: PosterBox[][]; gaps: PosterGap[] }

/** The Poster Settings custom property names of theme.css. */
export const POSTER_SETTING_PROPERTIES = {
  columns: "--poster-columns",
  sectionMargin: "--poster-section-margin",
  contentMargin: "--poster-content-margin",
  headerHeight: "--poster-header-height",
  typeScale: "--poster-type-scale",
} as const;

/** The most columns a sectioned poster has. */
export const POSTER_MAX_COLUMNS = 6;

const PX_LENGTH = /^(\d+(?:\.\d{1,2})?)px$/;
const NUMBER = /^\d+(?:\.\d+)?$/;
const WEIGHT = /^\d+(?:\.\d{1,2})?$/;
const COLUMN = /^\d+$/;

/** Rounds to 2 decimals, writing -0 as 0. */
export const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** The last value of each custom property of the first :root rule; empty on a theme that cannot be read. */
function themeValues(theme: string): Map<string, string> {
  const values = new Map<string, string>();
  try {
    for (const property of readThemeProperties(theme)) values.set(property.name, property.value.trim());
  } catch {
    // A broken theme reads as one without Poster Settings.
  }
  return values;
}

function readColumns(value: string | undefined): number[] | null {
  if (value === undefined) return null;
  const parts = value.split(/\s+/).filter((part) => part !== "");
  if (parts.length < 1 || parts.length > POSTER_MAX_COLUMNS || !parts.every((part) => NUMBER.test(part))) return null;
  const ratios = parts.map(Number);
  return ratios.every((ratio) => Number.isFinite(ratio) && ratio > 0) ? ratios : null;
}

function readLength(value: string | undefined, positive: boolean): number | null {
  const match = value === undefined ? null : PX_LENGTH.exec(value);
  if (!match) return null;
  const length = Number(match[1]);
  return positive && length <= 0 ? null : length;
}

function readScale(value: string | undefined): number | null {
  if (value === undefined || !NUMBER.test(value)) return null;
  const scale = Number(value);
  return scale >= 0.5 && scale <= 2 ? scale : null;
}

/** The Poster Settings of the theme for a canvas of width x height px, each invalid or missing value read as its default; never throws. */
export function readPosterSettings(theme: string, width: number, height: number): PosterSettings {
  const values = themeValues(typeof theme === "string" ? theme : "");
  const short = Math.min(width, height);
  return {
    columns: readColumns(values.get(POSTER_SETTING_PROPERTIES.columns)) ?? [1, 1, 1],
    sectionMargin: readLength(values.get(POSTER_SETTING_PROPERTIES.sectionMargin), false) ?? round2(short / 40),
    contentMargin: readLength(values.get(POSTER_SETTING_PROPERTIES.contentMargin), false) ?? round2(short / 80),
    headerHeight: readLength(values.get(POSTER_SETTING_PROPERTIES.headerHeight), true) ?? round2(height * 0.12),
    typeScale: readScale(values.get(POSTER_SETTING_PROPERTIES.typeScale)) ?? 1,
  };
}

/** A block's poster role from data-poster, and its data-column and data-weight values as written (undefined when absent). */
export interface PosterBlockInfo { block: DeckBlock; role: "header" | "section" | null; column: string | undefined; weight: string | undefined }

/** The blocks of the poster's slide with their poster attributes, in document order. */
export function posterBlocks(html: string, model: DeckModel): PosterBlockInfo[] {
  const slide = model.slides[0];
  if (!slide) return [];
  return slide.blocks.map((block) => {
    const attributes = blockTagAttributes(html, block);
    const value = (name: string): string | undefined => attributes.find((attribute) => attribute.name === name)?.value ?? undefined;
    const poster = value("data-poster");
    const role = poster === "header" || poster === "section" ? poster : null;
    return { block, role, column: value("data-column"), weight: value("data-weight") };
  });
}

const columnOf = (value: string | undefined, count: number): number => Math.min(value !== undefined && COLUMN.test(value) ? Number(value) : 0, count - 1);

const weightOf = (value: string | undefined): number => {
  const weight = value !== undefined && WEIGHT.test(value) ? Number(value) : 0;
  return weight > 0 ? weight : 1;
};

/** The geometry of the body: its top, height, and each column's left and width. */
export interface PosterBody { top: number; height: number; columns: Array<{ left: number; width: number }> }

/** The body geometry of the reflow rule, unrounded. */
export function posterBody(width: number, height: number, settings: PosterSettings, hasHeader: boolean): PosterBody {
  const m = settings.sectionMargin;
  const top = hasHeader ? 2 * m + settings.headerHeight : m;
  const count = settings.columns.length;
  const area = width - 2 * m - (count - 1) * m;
  const sum = settings.columns.reduce((total, ratio) => total + ratio, 0);
  let left = m;
  const columns = settings.columns.map((ratio) => {
    const column = { left, width: (area * ratio) / sum };
    left += column.width + m;
    return column;
  });
  return { top, height: height - top - m, columns };
}

const rounded = (left: number, top: number, width: number, height: number): DeckRect => ({ left: round2(left), top: round2(top), width: round2(width), height: round2(height) });

/** The sections of one column laid out from the body top, with the gaps between them. */
function layoutColumn(body: PosterBody, column: number, entries: Array<{ id: string; weight: number }>, m: number): { boxes: PosterBox[]; gaps: PosterGap[] } {
  const { left, width } = body.columns[column]!;
  const total = body.height - (entries.length - 1) * m;
  const sum = entries.reduce((value, entry) => value + entry.weight, 0);
  const boxes: PosterBox[] = [];
  const gaps: PosterGap[] = [];
  let top = body.top;
  for (const [index, entry] of entries.entries()) {
    const height = (total * entry.weight) / sum;
    boxes.push({ id: entry.id, role: "section", column, weight: entry.weight, rect: rounded(left, top, width, height) });
    if (index < entries.length - 1) gaps.push({ kind: "section", index, column, rect: rounded(left, top + height, width, m) });
    top += height + m;
  }
  return { boxes, gaps };
}

/** The canvas and model of a poster deck, or null for anything else. */
export function posterCanvas(html: string): { model: DeckModel; size: DeckSize; width: number; height: number } | null {
  const model = parseDeck(html).model;
  if (!model || model.kind !== "poster" || !model.size) return null;
  const { width, height } = deckCanvasPx(model.size);
  return { model, size: model.size, width, height };
}

/** The reflowed header, columns and gaps of a sectioned poster; null for a talk or a poster with no section. Writes nothing. */
export function readPosterLayout(html: string, theme: string): PosterLayout | null {
  const canvas = posterCanvas(html);
  if (!canvas) return null;
  const infos = posterBlocks(html, canvas.model);
  if (!infos.some((info) => info.role === "section")) return null;
  const { width, height } = canvas;
  const settings = readPosterSettings(theme, width, height);
  const m = settings.sectionMargin;
  const headerInfo = infos.find((info) => info.role === "header");
  const header: PosterBox | null = headerInfo
    ? { id: headerInfo.block.id, role: "header", column: 0, weight: 1, rect: rounded(m, m, width - 2 * m, settings.headerHeight) }
    : null;
  const body = posterBody(width, height, settings, header !== null);
  const count = settings.columns.length;
  const entries: Array<Array<{ id: string; weight: number }>> = Array.from({ length: count }, () => []);
  for (const info of infos) {
    if (info.role === "section") entries[columnOf(info.column, count)]!.push({ id: info.block.id, weight: weightOf(info.weight) });
  }
  const columns: PosterBox[][] = [];
  const gaps: PosterGap[] = [];
  for (const [index, column] of entries.entries()) {
    const laid = layoutColumn(body, index, column, m);
    columns.push(laid.boxes);
    gaps.push(...laid.gaps);
    const slot = body.columns[index]!;
    if (index < count - 1) gaps.push({ kind: "column", index, column: index, rect: rounded(slot.left + slot.width, body.top, m, body.height) });
  }
  return { width, height, settings, header, columns, gaps };
}

const PT_TO_PX = 96 / 72;

/** The print-sized type of a poster in px: the small text floor of the size for captions and its multiples for the rest, times typeScale. */
export function posterTypeSizes(size: import("./deckSizes.js").DeckSize, typeScale: number): { title: number; authors: number; heading: number; body: number; caption: number } {
  const floor = smallTextThresholdPt(size);
  const at = (multiple: number): number => round2(floor * multiple * typeScale * PT_TO_PX);
  return { title: at(3.5), authors: at(1.75), heading: at(2), body: at(1.33), caption: at(1) };
}
