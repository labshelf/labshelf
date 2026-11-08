/**
 * Grid-cell classes on deck blocks: reading col-/row-/span-/rows- from a class value and the start-tag splices that place a block on a cell or drop its cell classes.
 */
import { DECK_GRID_MAX, type DeckCell } from "./deckGrid.js";
import { splitDeclarations, type DeckBlock } from "./deckParse.js";
import { tokenizeDeckHtml, type DeckAttribute, type DeckRange } from "./deckTokens.js";

export interface DeckSplice { from: number; to: number; text: string }

const CELL_CLASS = /^(col|row|span|rows)-(\d+)$/;
const CELL_NUMBER = /^[1-9]\d?$/;
const RECT_PROPERTIES = new Set(["left", "top", "width", "height"]);

const classTokens = (value: string): string[] => value.split(/\s+/).filter(Boolean);
const isCellClass = (token: string): boolean => CELL_CLASS.test(token);

/** The cell of a class value when col-, row-, span- and rows- are all present with whole numbers 1 to 24, else null; the first class of each kind counts. */
export function readDeckCell(classValue: string): DeckCell | null {
  const found: Partial<Record<"col" | "row" | "span" | "rows", number>> = {};
  for (const token of classTokens(classValue)) {
    const match = CELL_CLASS.exec(token);
    if (!match) continue;
    const kind = match[1] as "col" | "row" | "span" | "rows";
    // A leading zero has no CSS rule, so col-01 is not a cell class.
    if (found[kind] === undefined) found[kind] = CELL_NUMBER.test(match[2]!) ? Number(match[2]) : 0;
  }
  const values = [found.col, found.row, found.span, found.rows];
  if (!values.every((value) => value !== undefined && value >= 1 && value <= DECK_GRID_MAX)) return null;
  return { col: found.col!, row: found.row!, span: found.span!, rows: found.rows! };
}

/** The four cell classes of a cell, in the order col, row, span, rows. */
export const deckCellClasses = (cell: DeckCell): string => `col-${cell.col} row-${cell.row} span-${cell.span} rows-${cell.rows}`;

/** The attributes of a block's start tag with ranges in the deck. */
export function blockTagAttributes(html: string, block: DeckBlock): DeckAttribute[] {
  const shift = (range: DeckRange): DeckRange => ({ from: range.from + block.startTag.from, to: range.to + block.startTag.from });
  const token = tokenizeDeckHtml(html.slice(block.startTag.from, block.startTag.to)).tokens.find((candidate) => candidate.kind === "start");
  if (!token || token.kind !== "start") return [];
  return token.attributes.map((attribute) => ({ ...attribute, range: shift(attribute.range), valueRange: attribute.valueRange && shift(attribute.valueRange) }));
}

/** Removes an attribute with the whitespace before it. */
export function attributeRemoval(html: string, attribute: DeckAttribute): DeckSplice {
  let from = attribute.range.from;
  while (from > 0 && /\s/.test(html[from - 1]!)) from--;
  return { from, to: attribute.range.to, text: "" };
}

/** Drops the cell classes of a block, and the class attribute when nothing is left; null when it has none. */
export function cellClassRemoval(html: string, block: DeckBlock): DeckSplice | null {
  const attribute = blockTagAttributes(html, block).find((candidate) => candidate.name === "class");
  if (!attribute?.valueRange) return null;
  const tokens = classTokens(html.slice(attribute.valueRange.from, attribute.valueRange.to));
  if (!tokens.some(isCellClass)) return null;
  const kept = tokens.filter((token) => !isCellClass(token));
  return kept.length === 0 ? attributeRemoval(html, attribute) : { ...attribute.valueRange, text: kept.join(" ") };
}

/** Writes the four cell classes (after data-block when there is no class attribute) and removes left, top, width and height from the style, and an emptied style attribute. */
export function placeSplices(html: string, block: DeckBlock, cell: DeckCell): DeckSplice[] {
  const attributes = blockTagAttributes(html, block);
  const splices: DeckSplice[] = [];
  const classAttribute = attributes.find((attribute) => attribute.name === "class");
  if (classAttribute?.valueRange) {
    const kept = classTokens(html.slice(classAttribute.valueRange.from, classAttribute.valueRange.to)).filter((token) => !isCellClass(token));
    splices.push({ ...classAttribute.valueRange, text: [...kept, deckCellClasses(cell)].join(" ") });
  } else {
    if (classAttribute) splices.push(attributeRemoval(html, classAttribute));
    const anchor = attributes.find((attribute) => attribute.name === "data-block");
    const at = anchor ? anchor.range.to : block.startTag.from + html.slice(block.startTag.from).search(/[\s/>]/);
    // Before the style removal, so at the same offset the class lands first.
    splices.unshift({ from: at, to: at, text: ` class="${deckCellClasses(cell)}"` });
  }
  const style = attributes.find((attribute) => attribute.name === "style");
  if (style?.valueRange) {
    const declarations = splitDeclarations(html, style.valueRange);
    const kept = declarations.filter((declaration) => !RECT_PROPERTIES.has(html.slice(declaration.from, declaration.colon).trim().toLowerCase()));
    if (kept.length !== declarations.length) {
      const value = html.slice(style.valueRange.from, style.valueRange.to);
      const text = kept.map((declaration) => html.slice(declaration.from, Math.min(declaration.to, style.valueRange!.to)).trim()).join("; ");
      if (text === "") splices.push(attributeRemoval(html, style));
      else splices.push({ ...style.valueRange, text: value.trimEnd().endsWith(";") ? `${text};` : text });
    }
  }
  return splices;
}
