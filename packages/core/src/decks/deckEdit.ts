/**
 * Applies a DeckEdit to deck.html as text splices on the ranges parseDeck reports, so every byte outside the splices stays.
 */
import { parseDeck, type DeckBlock, type DeckModel, type DeckRange } from "./deckParse.js";
import { deckCanvasPx, formatDeckSize, isDeckSizeAllowed, type DeckSize } from "./deckSizes.js";
import { tokenizeDeckHtml } from "./deckTokens.js";

export type DeckEdit =
  | { kind: "move"; block: string; left: number; top: number }
  | { kind: "resize"; block: string; left: number; top: number; width: number; height: number }
  | { kind: "setText"; block: string; leaf: number; text: string }
  | { kind: "moveSlide"; from: number; to: number }
  | { kind: "addSlide"; at: number; html?: string }
  | { kind: "duplicateSlide"; slide: number }
  | { kind: "deleteSlide"; slide: number }
  | { kind: "addBlock"; slide: number; html: string }
  | { kind: "deleteBlock"; block: string }
  | { kind: "setSize"; size: DeckSize; scale: boolean };

export type DeckEditResult = { ok: true; html: string } | { ok: false; error: string };

interface Splice { from: number; to: number; text: string }

type RectValues = { left: number; top: number; width?: number; height?: number };

const BLOCK_ID = /^[a-z][a-z0-9-]{0,39}$/;
const RECT_ORDER = ["left", "top", "width", "height"] as const;
const DEFAULT_SLIDE = "<section data-slide></section>";

const fail = (error: string): DeckEditResult => ({ ok: false, error });

/** Applies one edit; never throws, every failure is {ok: false, error}. */
export function applyDeckEdit(html: string, edit: DeckEdit): DeckEditResult {
  try {
    const model = parseDeck(html).model;
    if (!model) return fail("The deck has no html element with a body, so it cannot be edited.");
    return applyToModel(html, model, edit);
  } catch (error) {
    return fail(`The edit failed: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`);
  }
}

function applyToModel(html: string, model: DeckModel, edit: DeckEdit): DeckEditResult {
  switch (edit.kind) {
    case "move":
    case "resize": {
      const block = findBlock(model, edit.block);
      if (!block) return unknownBlock(edit.block);
      const values: RectValues = edit.kind === "move" ? { left: edit.left, top: edit.top } : { left: edit.left, top: edit.top, width: edit.width, height: edit.height };
      const problem = checkRect(values);
      if (problem) return fail(problem);
      return { ok: true, html: applySplices(html, rectSplices(html, block, values)) };
    }
    case "setText": {
      const block = findBlock(model, edit.block);
      if (!block) return unknownBlock(edit.block);
      const leaf = isIndex(edit.leaf, block.leaves.length) ? block.leaves[edit.leaf] : undefined;
      if (!leaf) return fail(`Block "${edit.block}" has no text leaf ${String(edit.leaf)}.`);
      if (typeof edit.text !== "string") return fail("The text must be a string.");
      return { ok: true, html: applySplices(html, [{ ...leaf.contentRange, text: escapeText(edit.text) }]) };
    }
    case "deleteBlock": {
      const block = findBlock(model, edit.block);
      if (!block) return unknownBlock(edit.block);
      return { ok: true, html: applySplices(html, [{ ...lineRemoval(html, block.range), text: "" }]) };
    }
    case "addBlock":
      return addBlock(html, model, edit.slide, edit.html);
    case "addSlide": {
      if (model.kind === "poster") return fail("A poster has exactly one slide, so it cannot get another.");
      if (!isIndex(edit.at, model.slides.length + 1)) return fail(`Slide position ${String(edit.at)} is out of range.`);
      const text = edit.html ?? DEFAULT_SLIDE;
      const problem = checkSlideHtml(html, text);
      if (problem) return fail(problem);
      return { ok: true, html: insertSlide(html, model, edit.at, text) };
    }
    case "duplicateSlide":
      return duplicateSlide(html, model, edit.slide);
    case "deleteSlide": {
      const slide = isIndex(edit.slide, model.slides.length) ? model.slides[edit.slide] : undefined;
      if (!slide) return fail(`Slide ${String(edit.slide)} does not exist.`);
      if (model.slides.length === 1) return fail("The only slide of a deck cannot be deleted.");
      return { ok: true, html: applySplices(html, [{ ...lineRemoval(html, slide.range), text: "" }]) };
    }
    case "moveSlide":
      return moveSlide(html, model, edit.from, edit.to);
    case "setSize":
      return setSize(html, model, edit.size, edit.scale);
    default:
      return fail("The edit kind is not known.");
  }
}

const unknownBlock = (id: string): DeckEditResult => fail(`No block has the id "${String(id)}".`);

const isIndex = (value: number, length: number): boolean => Number.isInteger(value) && value >= 0 && value < length;

function findBlock(model: DeckModel, id: string): DeckBlock | undefined {
  for (const slide of model.slides) {
    const block = slide.blocks.find((candidate) => candidate.id === id);
    if (block) return block;
  }
  return undefined;
}

/** Applies splices from the end so earlier offsets stay valid; at one offset, earlier splices end up first. */
function applySplices(html: string, splices: Splice[]): string {
  const ordered = splices.map((splice, index) => ({ splice, index })).sort((a, b) => b.splice.from - a.splice.from || b.index - a.index);
  let result = html;
  for (const { splice } of ordered) result = result.slice(0, splice.from) + splice.text + result.slice(splice.to);
  return result;
}

/** Rounds to 2 decimals, drops trailing zeros and writes -0 as 0, then px. */
function formatPx(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function checkRect(values: RectValues): string | null {
  for (const property of RECT_ORDER) {
    const value = values[property];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) return `The ${property} must be a finite number.`;
    if ((property === "width" || property === "height") && value < 0) return `The ${property} must not be negative.`;
  }
  return null;
}

/** Replaces existing left/top/width/height values and appends the missing declarations, or adds a style attribute. */
function rectSplices(html: string, block: DeckBlock, values: RectValues): Splice[] {
  const splices: Splice[] = [];
  const missing: string[] = [];
  for (const property of RECT_ORDER) {
    const value = values[property];
    if (value === undefined) continue;
    const range = block.rectRanges[property];
    if (range && block.styleRange) splices.push({ ...range, text: formatPx(value) });
    else missing.push(`${property}: ${formatPx(value)};`);
  }
  if (missing.length === 0) return splices;
  const style = block.styleRange;
  if (!style) {
    const tagEnd = block.startTag.to;
    const at = html.slice(tagEnd - 2, tagEnd) === "/>" ? tagEnd - 2 : tagEnd - 1;
    splices.push({ from: at, to: at, text: ` style="${missing.join(" ")}"` });
    return splices;
  }
  const value = html.slice(style.from, style.to);
  const trimmed = value.trimEnd();
  const empty = trimmed.trim().length === 0;
  if (!empty && !trimmed.endsWith(";")) {
    const at = style.from + trimmed.length;
    splices.push({ from: at, to: at, text: ";" });
  }
  splices.push({ from: style.to, to: style.to, text: missing.map((declaration, index) => (empty && index === 0 ? declaration : ` ${declaration}`)).join("") });
  return splices;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

/** Widens a removal to its whole line (indentation and one line break) when the range is alone on its line. */
function lineRemoval(html: string, range: DeckRange): DeckRange {
  let start = range.from;
  while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) start--;
  if (start > 0 && html[start - 1] !== "\n") return range;
  if (range.to === html.length) return { from: start, to: range.to };
  if (html[range.to] === "\n") return { from: start, to: range.to + 1 };
  if (html.startsWith("\r\n", range.to)) return { from: start, to: range.to + 2 };
  return range;
}

/** \n followed by the spaces and tabs before the range on its line. */
function separator(html: string, range: DeckRange): string {
  let start = range.from;
  while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) start--;
  return `\n${html.slice(start, range.from)}`;
}

/** Every data-block value in the text, in source order, with its value range. */
function blockIdAttributes(text: string): Array<{ id: string; range: DeckRange }> {
  const ids: Array<{ id: string; range: DeckRange }> = [];
  for (const token of tokenizeDeckHtml(text).tokens) {
    if (token.kind !== "start") continue;
    for (const attribute of token.attributes) {
      if (attribute.name === "data-block" && attribute.value != null && attribute.valueRange) ids.push({ id: attribute.value, range: attribute.valueRange });
    }
  }
  return ids;
}

/** Checks that new ids are valid, unique among themselves and unused in the deck. */
function checkNewIds(html: string, ids: string[]): string | null {
  const used = new Set(blockIdAttributes(html).map((entry) => entry.id));
  const seen = new Set<string>();
  for (const id of ids) {
    if (!BLOCK_ID.test(id)) return `The block id "${id}" is not valid; use a lowercase letter followed by up to 39 lowercase letters, digits or hyphens.`;
    if (used.has(id) || seen.has(id)) return `The block id "${id}" is already used.`;
    seen.add(id);
  }
  return null;
}

const WRAP_START = "<html><body>";
const WRAP_END = "</body></html>";

/** The html must be one data-slide section with valid, new block ids. */
function checkSlideHtml(deck: string, text: string): string | null {
  if (typeof text !== "string") return "The slide html must be a string.";
  const parsed = parseDeck(`${WRAP_START}${text}${WRAP_END}`);
  const slides = parsed.model?.slides ?? [];
  const slide = slides[0];
  const trimmedFrom = WRAP_START.length + (text.length - text.trimStart().length);
  const trimmedTo = WRAP_START.length + text.trimEnd().length;
  if (parsed.problems.length > 0 || slides.length !== 1 || !slide || slide.range.from !== trimmedFrom || slide.range.to !== trimmedTo) {
    return "The slide html must be exactly one <section data-slide> element.";
  }
  return checkNewIds(deck, blockIdAttributes(text).map((entry) => entry.id));
}

/** Inserts slide text at index `at` of the model's slides, separated as the neighbouring slide is. */
function insertSlide(html: string, model: DeckModel, at: number, text: string): string {
  const slides = model.slides;
  if (slides.length === 0) return applySplices(html, [{ from: model.bodyContentRange.to, to: model.bodyContentRange.to, text: `${text}\n` }]);
  if (at < slides.length) {
    const target = slides[at]!.range;
    return applySplices(html, [{ from: target.from, to: target.from, text: `${text}${separator(html, target)}` }]);
  }
  const last = slides[slides.length - 1]!.range;
  return applySplices(html, [{ from: last.to, to: last.to, text: `${separator(html, last)}${text}` }]);
}

function duplicateSlide(html: string, model: DeckModel, index: number): DeckEditResult {
  if (model.kind === "poster") return fail("A poster has exactly one slide, so it cannot be duplicated.");
  const slide = isIndex(index, model.slides.length) ? model.slides[index] : undefined;
  if (!slide) return fail(`Slide ${String(index)} does not exist.`);
  const source = html.slice(slide.range.from, slide.range.to);
  const used = new Set(blockIdAttributes(html).map((entry) => entry.id));
  const renames: Splice[] = [];
  for (const { id, range } of blockIdAttributes(source)) {
    let n = 2;
    while (used.has(`${id}-${n}`)) n++;
    const renamed = `${id}-${n}`;
    if (renamed.length > 40) return fail(`The copied block id "${renamed}" would be longer than 40 characters.`);
    used.add(renamed);
    renames.push({ ...range, text: renamed });
  }
  const copy = applySplices(source, renames);
  return { ok: true, html: applySplices(html, [{ from: slide.range.to, to: slide.range.to, text: `${separator(html, slide.range)}${copy}` }]) };
}

function moveSlide(html: string, model: DeckModel, from: number, to: number): DeckEditResult {
  const length = model.slides.length;
  if (!isIndex(from, length)) return fail(`Slide ${String(from)} does not exist.`);
  if (!isIndex(to, length)) return fail(`Slide position ${String(to)} is out of range.`);
  if (from === to) return { ok: true, html };
  const slide = model.slides[from]!;
  const text = html.slice(slide.range.from, slide.range.to);
  const removed = applySplices(html, [{ ...lineRemoval(html, slide.range), text: "" }]);
  const remaining = parseDeck(removed).model;
  if (!remaining || remaining.slides.length !== length - 1) return fail("The slide could not be moved because the deck markup is ambiguous.");
  return { ok: true, html: insertSlide(removed, remaining, to, text) };
}

function addBlock(html: string, model: DeckModel, index: number, text: string): DeckEditResult {
  const slide = isIndex(index, model.slides.length) ? model.slides[index] : undefined;
  if (!slide) return fail(`Slide ${String(index)} does not exist.`);
  if (typeof text !== "string") return fail("The block html must be a string.");
  const prefix = `${WRAP_START}<section data-slide>`;
  const parsed = parseDeck(`${prefix}${text}</section>${WRAP_END}`);
  const blocks = parsed.model?.slides[0]?.blocks ?? [];
  const block = blocks[0];
  const trimmedFrom = prefix.length + (text.length - text.trimStart().length);
  const trimmedTo = prefix.length + text.trimEnd().length;
  if (parsed.problems.length > 0 || blocks.length !== 1 || !block || block.range.from !== trimmedFrom || block.range.to !== trimmedTo) {
    return fail("The block html must be exactly one element with a data-block id.");
  }
  const problem = checkNewIds(html, blockIdAttributes(text).map((entry) => entry.id));
  if (problem) return fail(problem);
  const at = slide.notes ? slide.notes.range.from : slide.contentRange.to;
  return { ok: true, html: applySplices(html, [{ from: at, to: at, text }]) };
}

function setSize(html: string, model: DeckModel, size: DeckSize, scale: boolean): DeckEditResult {
  if (!model.kind) return fail("The deck has no valid data-deck kind, so its size cannot be checked.");
  if (!model.sizeRange) return fail("The deck has no data-deck-size attribute to change.");
  if (!size || !isDeckSizeAllowed(model.kind, size)) return fail(`That size is not allowed for a ${model.kind}.`);
  const splices: Splice[] = [{ ...model.sizeRange, text: formatDeckSize(size) }];
  if (scale) {
    const current = model.size;
    if (!current || !isDeckSizeAllowed(model.kind, current)) return fail("The current deck size is not valid, so block geometry cannot be scaled.");
    const before = deckCanvasPx(current);
    const after = deckCanvasPx(size);
    const sx = after.width / before.width;
    const sy = after.height / before.height;
    for (const slide of model.slides) {
      for (const block of slide.blocks) {
        if (!block.rect) continue;
        const { left, top, width, height } = block.rect;
        splices.push(...rectSplices(html, block, { left: left * sx, top: top * sy, width: width * sx, height: height * sy }));
      }
    }
  }
  return { ok: true, html: applySplices(html, splices) };
}
