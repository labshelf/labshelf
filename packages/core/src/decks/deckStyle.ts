// The inline style of a deck block beyond its geometry (typeface, size, weight, slant, decoration, colour, line height, alignment, padding) and the
// shape blocks (one inline <svg> with a rect, ellipse or line) with their fill, stroke and stroke width; each written as splices.
import type { DeckBlock, DeckModel } from "./deckParse.js";
import type { DeckEditResult } from "./deckEdit.js";
import { parseDeck } from "./deckParse.js";

/** The text style declarations the properties panel writes on a block's style attribute. */
const DECK_TEXT_DECLARATIONS = ["font-family", "font-size", "font-weight", "font-style", "text-decoration", "color", "line-height", "text-align", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left"] as const;
export type DeckTextDeclaration = (typeof DECK_TEXT_DECLARATIONS)[number];

const GEOMETRY = new Set(["left", "top", "width", "height"]);

function declarations(css: string): Array<[string, string]> {
  return css.split(";").flatMap((part) => {
    const colon = part.indexOf(":");
    if (colon === -1) return [];
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    return name ? [[name, value] as [string, string]] : [];
  });
}

/** The block's inline declarations by name, geometry included. */
export function readBlockStyle(html: string, block: Pick<DeckBlock, "styleRange">): Record<string, string> {
  return block.styleRange ? Object.fromEntries(declarations(html.slice(block.styleRange.from, block.styleRange.to))) : {};
}

const SAFE_VALUE = /^[^;{}<>"\\]*$/;

/**
 * The deck with the block's text declarations changed: a value replaces the declaration (or is appended), null removes it;
 * geometry and other declarations keep their order. Fails on an unknown name or a value that could leave the attribute.
 */
export function setBlockStyle(html: string, blockId: string, changes: Partial<Record<DeckTextDeclaration, string | null>>): DeckEditResult {
  const block = findDeckBlock(parseDeck(html).model, blockId);
  if (!block) return { ok: false, error: `No block has the id "${blockId}".` };
  if (!block.styleRange) return { ok: false, error: "The block has no style attribute." };
  for (const [name, value] of Object.entries(changes)) {
    if (!(DECK_TEXT_DECLARATIONS as readonly string[]).includes(name) || GEOMETRY.has(name)) return { ok: false, error: `${name} is not a text style.` };
    if (value !== null && value !== undefined && !SAFE_VALUE.test(value)) return { ok: false, error: `${name} cannot be "${value}".` };
  }
  const list = declarations(html.slice(block.styleRange.from, block.styleRange.to));
  const left = new Map(Object.entries(changes));
  const kept = list.flatMap(([name, value]): Array<[string, string]> => {
    if (!left.has(name)) return [[name, value]];
    const next = left.get(name);
    left.delete(name);
    return next === null || next === undefined || next === "" ? [] : [[name, next]];
  });
  for (const [name, value] of left) if (value) kept.push([name, value]);
  const css = `${kept.map(([name, value]) => `${name}: ${value}`).join("; ")};`;
  return { ok: true, html: html.slice(0, block.styleRange.from) + css + html.slice(block.styleRange.to) };
}

/** The block of the deck with the id, on any slide. */
export function findDeckBlock(model: DeckModel | undefined, id: string): DeckBlock | undefined {
  return model?.slides.flatMap((slide) => slide.blocks).find((block) => block.id === id);
}

// Shapes

export type DeckShapeKind = "rect" | "ellipse" | "line";
export interface DeckShapeStyle { fill: string; stroke: string; strokeWidth: number }

const SHAPE_BODY: Record<DeckShapeKind, (style: DeckShapeStyle) => string> = {
  rect: (s) => `<rect x="0" y="0" width="100" height="100" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" vector-effect="non-scaling-stroke"/>`,
  ellipse: (s) => `<ellipse cx="50" cy="50" rx="50" ry="50" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" vector-effect="non-scaling-stroke"/>`,
  line: (s) => `<line x1="0" y1="50" x2="100" y2="50" fill="none" stroke="${s.stroke}" stroke-width="${Math.max(1, s.strokeWidth)}" vector-effect="non-scaling-stroke"/>`,
};

/** A canvas length as a px value with at most two decimals. */
export const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

const COLOUR = /^(#[0-9a-fA-F]{3,8}|none|transparent|[a-z]+)$/;

/** The html of a new shape block `id` at `rect` (canvas px): one inline svg stretched to the block. */
export function shapeBlockHtml(id: string, kind: DeckShapeKind, rect: { left: number; top: number; width: number; height: number }, style: DeckShapeStyle = { fill: "#1f5673", stroke: "none", strokeWidth: 0 }): string {
  return `<div data-block="${id}" style="left: ${px(rect.left)}; top: ${px(rect.top)}; width: ${px(rect.width)}; height: ${px(kind === "line" ? Math.max(rect.height, 8) : rect.height)};">`
    + `<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">${SHAPE_BODY[kind](style)}</svg></div>`;
}

const SHAPE = /<svg\b[^>]*>\s*<(rect|ellipse|line)\b([^>]*)\/>\s*<\/svg>/;

/** The shape a block holds, with its style; undefined for any other block. */
export function readBlockShape(html: string, block: Pick<DeckBlock, "range">): { kind: DeckShapeKind; style: DeckShapeStyle } | undefined {
  const match = SHAPE.exec(html.slice(block.range.from, block.range.to));
  if (!match) return undefined;
  const attr = (name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(match[2]!)?.[1];
  return { kind: match[1] as DeckShapeKind, style: { fill: attr("fill") ?? "none", stroke: attr("stroke") ?? "none", strokeWidth: Number(attr("stroke-width") ?? 0) || 0 } };
}

/** The deck with a shape block's fill, stroke or stroke width changed; fails for a block that holds no shape or a value that is not a colour. */
export function setBlockShapeStyle(html: string, blockId: string, changes: Partial<DeckShapeStyle>): DeckEditResult {
  const block = findDeckBlock(parseDeck(html).model, blockId);
  const shape = block && readBlockShape(html, block);
  if (!block || !shape) return { ok: false, error: "The block holds no shape." };
  if ((changes.fill && !COLOUR.test(changes.fill)) || (changes.stroke && !COLOUR.test(changes.stroke))) return { ok: false, error: "Colours are #rrggbb, a colour name or none." };
  if (changes.strokeWidth !== undefined && !(changes.strokeWidth >= 0 && changes.strokeWidth <= 100)) return { ok: false, error: "The stroke width is 0 to 100." };
  const style = { ...shape.style, ...changes };
  const body = html.slice(block.range.from, block.range.to);
  const match = SHAPE.exec(body)!;
  const start = block.range.from + match.index + match[0].indexOf(`<${match[1]}`);
  const end = start + match[0].slice(match[0].indexOf(`<${match[1]}`)).indexOf("/>") + 2;
  return { ok: true, html: html.slice(0, start) + SHAPE_BODY[shape.kind](style) + html.slice(end) };
}
