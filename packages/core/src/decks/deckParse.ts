/**
 * Parses deck.html into a DeckModel with source ranges: the root attributes, the theme link, slides, blocks with their geometry, text leaves and notes.
 */
import { readDeckCell } from "./deckCells.js";
import { deckCellFits, deckCellRect, deckGridFromTheme, type DeckCell, type DeckGrid } from "./deckGrid.js";
import type { DeckKind, DeckSize } from "./deckSizes.js";
import { deckCanvasPx, parseDeckSize } from "./deckSizes.js";
import { createDeckProblem, tokenizeDeckHtml, type DeckAttribute, type DeckParseProblem, type DeckRange, type DeckToken } from "./deckTokens.js";

export type { DeckParseProblem, DeckRange } from "./deckTokens.js";

export interface DeckRect { left: number; top: number; width: number; height: number }

export interface DeckLeaf { range: DeckRange; contentRange: DeckRange; text: string; math?: "inline" | "display" }

/** A block's geometry is either px in its style (rect from rectRanges) or, when the style has none of the four, the four cell classes (cell set, rect of the cell on the theme's grid). */
export interface DeckBlock { id: string; slide: number; range: DeckRange; startTag: DeckRange; styleRange: DeckRange | null; classRange: DeckRange | null; cell?: DeckCell; group?: string; rect: DeckRect | null; rectRanges: { left?: DeckRange; top?: DeckRange; width?: DeckRange; height?: DeckRange }; leaves: DeckLeaf[]; source?: { ref: string; hash?: string; range: DeckRange; hashRange?: DeckRange } }

export interface DeckNotes { range: DeckRange; contentRange: DeckRange; text: string }

export interface DeckSlide { index: number; range: DeckRange; contentRange: DeckRange; notes?: DeckNotes; blocks: DeckBlock[] }

export interface DeckModel { kind: DeckKind | null; version: string | null; size: DeckSize | null; sizeRange: DeckRange | null; themeLink: DeckRange | null; bodyContentRange: DeckRange; slides: DeckSlide[] }

export interface DeckParseResult { model?: DeckModel; problems: DeckParseProblem[] }

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const PHRASING_ELEMENTS = new Set(["a", "b", "i", "em", "strong", "u", "s", "sub", "sup", "small", "mark", "code", "span"]);
const RECT_VALUE = /^-?\d+(\.\d{1,2})?px$/;
const RECT_PROPERTIES = ["left", "top", "width", "height"] as const;

interface ElementNode {
  type: "element";
  name: string;
  attributes: DeckAttribute[];
  startTag: DeckRange;
  range: DeckRange;
  contentRange: DeckRange;
  children: DeckNode[];
}

type DeckNode = ElementNode | { type: "text"; text: string } | { type: "comment" };

/** The canvas and grid that cell classes are laid out on. */
interface CellLayout { canvas: { width: number; height: number }; grid: DeckGrid }

/** Parses deck HTML; no model only when there is no html element or no body inside it. Problems are never thrown. `theme` (theme.css) gives the layout grid of cell blocks. */
export function parseDeck(html: string, options: { theme?: string } = {}): DeckParseResult {
  const { tokens, problems } = tokenizeDeckHtml(html);
  const root = buildTree(html, tokens, problems);
  problems.sort((a, b) => a.offset - b.offset);
  const htmlElement = findElement(root, (node) => node.name === "html");
  const body = htmlElement && findElement(htmlElement, (node) => node.name === "body");
  if (!htmlElement || !body) return { problems };
  const themeLink = findElement(htmlElement, (node) => node.name === "link" && hasAttribute(node, "data-deck-theme"));
  const kind = readAttribute(htmlElement, "data-deck")?.value;
  const sizeAttribute = readAttribute(htmlElement, "data-deck-size");
  const size = sizeAttribute?.value != null ? parseDeckSize(sizeAttribute.value) : null;
  const canvas = size ? deckCanvasPx(size) : null;
  const layout = canvas ? { canvas, grid: deckGridFromTheme(options.theme ?? "", canvas) } : null;
  const slides = childElements(body)
    .filter((node) => node.name === "section" && hasAttribute(node, "data-slide"))
    .map((node, index) => readSlide(html, node, index, layout));
  return {
    model: {
      kind: kind === "talk" || kind === "poster" ? kind : null,
      version: readAttribute(htmlElement, "data-deck-version")?.value ?? null,
      size,
      sizeRange: sizeAttribute?.valueRange ?? null,
      themeLink: themeLink ? themeLink.startTag : null,
      bodyContentRange: body.contentRange,
      slides,
    },
    problems,
  };
}

/** Builds the element tree: void and self-closed elements are empty, every other element needs an explicit end tag. */
function buildTree(html: string, tokens: DeckToken[], problems: DeckParseProblem[]): ElementNode {
  const root: ElementNode = { type: "element", name: "#root", attributes: [], startTag: { from: 0, to: 0 }, range: { from: 0, to: html.length }, contentRange: { from: 0, to: html.length }, children: [] };
  const stack: ElementNode[] = [root];
  const notClosed = (node: ElementNode, at: number) => {
    problems.push(createDeckProblem(html, node.startTag.from, `<${node.name}> is not closed`));
    node.range = { from: node.range.from, to: at };
    node.contentRange = { from: node.contentRange.from, to: at };
  };
  for (const token of tokens) {
    const parent = stack[stack.length - 1]!;
    if (token.kind === "text") parent.children.push({ type: "text", text: token.text });
    else if (token.kind === "comment") parent.children.push({ type: "comment" });
    else if (token.kind === "start") {
      const empty = token.selfClosing || VOID_ELEMENTS.has(token.name);
      const node: ElementNode = {
        type: "element",
        name: token.name,
        attributes: token.attributes,
        startTag: token.range,
        range: { ...token.range },
        contentRange: { from: token.range.to, to: token.range.to },
        children: [],
      };
      parent.children.push(node);
      if (!empty) stack.push(node);
    } else if (token.kind === "end") {
      let match = stack.length - 1;
      while (match > 0 && stack[match]!.name !== token.name) match--;
      if (match === 0) {
        problems.push(createDeckProblem(html, token.range.from, `</${token.name}> has no open element`));
        continue;
      }
      while (stack.length - 1 > match) notClosed(stack.pop()!, token.range.from);
      const node = stack.pop()!;
      node.range = { from: node.range.from, to: token.range.to };
      node.contentRange = { from: node.contentRange.from, to: token.range.from };
    }
  }
  while (stack.length > 1) notClosed(stack.pop()!, html.length);
  return root;
}

const childElements = (node: ElementNode): ElementNode[] => node.children.filter((child): child is ElementNode => child.type === "element");

/** The first descendant element, depth first in source order, that matches. */
function findElement(node: ElementNode, test: (node: ElementNode) => boolean): ElementNode | undefined {
  for (const child of childElements(node)) {
    if (test(child)) return child;
    const found = findElement(child, test);
    if (found) return found;
  }
  return undefined;
}

const readAttribute = (node: ElementNode, name: string): DeckAttribute | undefined => node.attributes.find((attribute) => attribute.name === name);
const hasAttribute = (node: ElementNode, name: string): boolean => readAttribute(node, name) !== undefined;

function readSlide(html: string, node: ElementNode, index: number, layout: CellLayout | null): DeckSlide {
  const children = childElements(node);
  const notesNode = children.find((child) => child.name === "aside" && hasAttribute(child, "data-notes"));
  const blocks = children.filter((child) => hasAttribute(child, "data-block")).map((child) => readBlock(html, child, index, layout));
  const slide: DeckSlide = { index, range: node.range, contentRange: node.contentRange, blocks };
  if (notesNode) slide.notes = { range: notesNode.range, contentRange: notesNode.contentRange, text: readText(notesNode, false) };
  return slide;
}

function readBlock(html: string, node: ElementNode, slide: number, layout: CellLayout | null): DeckBlock {
  const style = readAttribute(node, "style");
  const styleRange = style?.valueRange ?? null;
  const classRange = readAttribute(node, "class")?.valueRange ?? null;
  const { rect, rectRanges } = readRect(html, styleRange);
  const leaves: DeckLeaf[] = [];
  collectLeaves(node, leaves);
  const block: DeckBlock = { id: readAttribute(node, "data-block")?.value ?? "", slide, range: node.range, startTag: node.startTag, styleRange, classRange, rect, rectRanges, leaves };
  const cell = classRange && layout && Object.keys(rectRanges).length === 0 ? readDeckCell(html.slice(classRange.from, classRange.to)) : null;
  if (cell && layout && deckCellFits(cell, layout.grid)) {
    block.cell = cell;
    block.rect = deckCellRect(cell, layout.grid, layout.canvas);
  }
  const group = readAttribute(node, "data-group")?.value;
  if (group != null) block.group = group;
  const source = readAttribute(node, "data-source");
  if (source?.value != null && source.valueRange) {
    block.source = { ref: source.value, range: source.valueRange };
    const hash = readAttribute(node, "data-source-hash");
    if (hash?.value != null && hash.valueRange) {
      block.source.hash = hash.value;
      block.source.hashRange = hash.valueRange;
    }
  }
  return block;
}

/** Reads left, top, width and height from the raw style value; the last declaration of each counts. */
function readRect(html: string, styleRange: DeckRange | null): { rect: DeckRect | null; rectRanges: DeckBlock["rectRanges"] } {
  const rectRanges: DeckBlock["rectRanges"] = {};
  if (!styleRange) return { rect: null, rectRanges };
  for (const declaration of splitDeclarations(html, styleRange)) {
    const name = html.slice(declaration.from, declaration.colon).trim().toLowerCase();
    if (!(RECT_PROPERTIES as readonly string[]).includes(name)) continue;
    rectRanges[name as (typeof RECT_PROPERTIES)[number]] = trimRange(html, declaration.colon + 1, declaration.to);
  }
  const values: number[] = [];
  for (const property of RECT_PROPERTIES) {
    const range = rectRanges[property];
    const text = range ? html.slice(range.from, range.to) : "";
    if (!RECT_VALUE.test(text)) return { rect: null, rectRanges };
    values.push(parseFloat(text));
  }
  const [left, top, width, height] = values as [number, number, number, number];
  if (width < 0 || height < 0) return { rect: null, rectRanges };
  return { rect: { left, top, width, height }, rectRanges };
}

/** Splits a style value on `;` outside parentheses and quotes; only declarations holding a `:` are kept. */
export function splitDeclarations(html: string, range: DeckRange): Array<{ from: number; colon: number; to: number }> {
  const declarations: Array<{ from: number; colon: number; to: number }> = [];
  let from = range.from;
  let colon = -1;
  let depth = 0;
  let quote: string | null = null;
  for (let pos = range.from; pos <= range.to; pos++) {
    const char = pos < range.to ? html[pos] : ";";
    if (quote) {
      if (char === "\\") pos++;
      else if (char === quote) quote = null;
      if (pos < range.to) continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ":" && depth === 0 && colon === -1) colon = pos;
    else if (char === ";" && (depth === 0 || pos === range.to)) {
      if (colon !== -1) declarations.push({ from, colon, to: pos });
      from = pos + 1;
      colon = -1;
    }
  }
  return declarations;
}

function trimRange(html: string, from: number, to: number): DeckRange {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(html[start]!)) start++;
  while (end > start && /\s/.test(html[end - 1]!)) end--;
  return { from: start, to: end };
}

const isMath = (node: ElementNode): "inline" | "display" | undefined => {
  if (node.name === "span" && hasAttribute(node, "data-math")) return "inline";
  if (node.name === "div" && readAttribute(node, "data-math")?.value === "display") return "display";
  return undefined;
};

/** Whether every child is text, a comment, br, math or a phrasing element holding only such content. */
function holdsOnlyPhrasing(node: ElementNode): boolean {
  return node.children.every((child) => {
    if (child.type !== "element") return true;
    if (child.name === "br" || isMath(child)) return true;
    return PHRASING_ELEMENTS.has(child.name) && holdsOnlyPhrasing(child);
  });
}

function collectLeaves(node: ElementNode, leaves: DeckLeaf[]): void {
  for (const child of childElements(node)) {
    const math = isMath(child);
    if (math || (!VOID_ELEMENTS.has(child.name) && holdsOnlyPhrasing(child))) {
      const leaf: DeckLeaf = { range: child.range, contentRange: child.contentRange, text: readText(child, true) };
      if (math) leaf.math = math;
      leaves.push(leaf);
    } else collectLeaves(child, leaves);
  }
}

/** The decoded text content; br gives \n when `breaks` is set. */
function readText(node: ElementNode, breaks: boolean): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") text += child.text;
    else if (child.type === "element") text += breaks && child.name === "br" ? "\n" : readText(child, breaks);
  }
  return text;
}
