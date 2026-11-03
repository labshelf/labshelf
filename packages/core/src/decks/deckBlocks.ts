// Whole-block helpers of an HTML deck: what a block holds and how the editor names it, the html of new text, image and equation
// blocks, a free block id, and the splices that duplicate a block, bring it to the front or back of its slide and set a slide's notes.
import type { DeckBlock, DeckModel, DeckRect } from "./deckParse.js";
import type { DeckEditResult } from "./deckEdit.js";
import { parseDeck } from "./deckParse.js";
import { findDeckBlock as findBlock, px, readBlockShape } from "./deckStyle.js";

export type DeckBlockKind = "text" | "image" | "equation" | "shape";

const LABEL_LENGTH = 32;
const DUPLICATE_OFFSET = 24;

/** The kind of a block (a shape, an image, an equation or text) and a short label from its first words. */
export function describeDeckBlock(html: string, block: Pick<DeckBlock, "range" | "leaves" | "id">): { kind: DeckBlockKind; label: string } {
  const shape = readBlockShape(html, block);
  if (shape) return { kind: "shape", label: { rect: "Rectangle", ellipse: "Ellipse", line: "Line" }[shape.kind] };
  const text = block.leaves.find((leaf) => !leaf.math && leaf.text.trim())?.text.trim().replace(/\s+/g, " ");
  if (!text && /<img\b/i.test(html.slice(block.range.from, block.range.to))) return { kind: "image", label: "Image" };
  if (!text && block.leaves.some((leaf) => leaf.math)) return { kind: "equation", label: "Equation" };
  return { kind: "text", label: text ? (text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1)}…` : text) : block.id };
}

/** `prefix-n` with the smallest n no block of the deck uses. */
export function freeDeckBlockId(model: DeckModel | undefined, prefix: string): string {
  const taken = new Set(model?.slides.flatMap((slide) => slide.blocks.map((block) => block.id)) ?? []);
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const openTag = (id: string, rect: DeckRect): string => `<div data-block="${id}" style="left: ${px(rect.left)}; top: ${px(rect.top)}; width: ${px(rect.width)}; height: ${px(rect.height)};">`;

/** A text block holding one paragraph. */
export function textBlockHtml(id: string, rect: DeckRect, text: string): string {
  return `${openTag(id, rect)}<p>${escapeHtml(text)}</p></div>`;
}

/** An image block whose picture fits the block; `src` is relative to the deck. */
export function imageBlockHtml(id: string, rect: DeckRect, src: string): string {
  return `${openTag(id, rect)}<img src="${escapeHtml(src)}" alt="" style="width: 100%; height: 100%; object-fit: contain;"></div>`;
}

/** An equation block holding one display formula in TeX. */
export function equationBlockHtml(id: string, rect: DeckRect, tex: string): string {
  return `${openTag(id, rect)}<div data-math="display">${escapeHtml(tex)}</div></div>`;
}

/** The range of the block widened to its whole line when nothing else stands on it. */
function lineOf(html: string, block: DeckBlock): { from: number; to: number } {
  const start = html.lastIndexOf("\n", block.range.from - 1) + 1;
  const endBreak = html.indexOf("\n", block.range.to);
  const end = endBreak === -1 ? html.length : endBreak + 1;
  const alone = html.slice(start, block.range.from).trim() === "" && html.slice(block.range.to, end).trim() === "";
  return alone ? { from: start, to: end } : block.range;
}

/** The deck with a copy of the block after it, shifted down and right, under `newId`. */
export function duplicateDeckBlock(html: string, blockId: string, newId: string): DeckEditResult {
  const model = parseDeck(html).model;
  const block = findBlock(model, blockId);
  if (!block) return { ok: false, error: `No block has the id "${blockId}".` };
  if (findBlock(model, newId) || !/^[a-z][a-z0-9-]{0,39}$/.test(newId)) return { ok: false, error: `The block id "${newId}" cannot be used.` };
  const shift = (name: "left" | "top"): string => {
    const range = block.rectRanges[name];
    return range ? html.slice(range.from, range.to) : "";
  };
  let copy = html.slice(block.range.from, block.range.to).replace(`data-block="${blockId}"`, `data-block="${newId}"`);
  for (const name of ["left", "top"] as const) {
    const value = shift(name);
    const number = Number.parseFloat(value);
    if (value && Number.isFinite(number)) copy = copy.replace(new RegExp(`(\\b${name}\\s*:\\s*)${value.replace(/[.]/g, "\\.")}`), `$1${px(number + DUPLICATE_OFFSET)}`);
  }
  const line = lineOf(html, block);
  const indent = line.from === block.range.from ? "" : html.slice(line.from, block.range.from);
  const text = line.from === block.range.from ? copy : `${indent}${copy}\n`;
  return { ok: true, html: html.slice(0, line.to) + text + html.slice(line.to) };
}

/** The deck with the block moved last (drawn on top) or first (drawn under the others) in its slide. */
export function reorderDeckBlock(html: string, blockId: string, place: "front" | "back"): DeckEditResult {
  const model = parseDeck(html).model;
  const block = findBlock(model, blockId);
  const slide = block && model?.slides[block.slide];
  if (!block || !slide) return { ok: false, error: `No block has the id "${blockId}".` };
  const others = slide.blocks.filter((other) => other.id !== blockId);
  const anchor = place === "front" ? others.at(-1) : others[0];
  if (!anchor) return { ok: true, html };
  const line = lineOf(html, block);
  const text = html.slice(line.from, line.to);
  const anchorLine = lineOf(html, anchor);
  const at = place === "front" ? anchorLine.to : anchorLine.from;
  if (at > line.to) return { ok: true, html: html.slice(0, line.from) + html.slice(line.to, at) + text + html.slice(at) };
  return { ok: true, html: html.slice(0, at) + text + html.slice(at, line.from) + html.slice(line.to) };
}

/** The deck with the slide's speaker notes set to `text`: the notes rewritten, added before the section's end, or removed when empty. */
export function setDeckSlideNotes(html: string, slideIndex: number, text: string): DeckEditResult {
  const slide = parseDeck(html).model?.slides[slideIndex];
  if (!slide) return { ok: false, error: `Slide ${slideIndex} does not exist.` };
  const body = escapeHtml(text.trim());
  if (slide.notes) {
    if (!body) return { ok: true, html: html.slice(0, slide.notes.range.from) + html.slice(slide.notes.range.to) };
    return { ok: true, html: html.slice(0, slide.notes.contentRange.from) + body + html.slice(slide.notes.contentRange.to) };
  }
  if (!body) return { ok: true, html };
  const at = slide.contentRange.to;
  return { ok: true, html: `${html.slice(0, at)}<aside data-notes>${body}</aside>${html.slice(at)}` };
}

/** The deck with the first picture of an image block pointing at `src`. */
export function setDeckImageSource(html: string, blockId: string, src: string): DeckEditResult {
  const block = findBlock(parseDeck(html).model, blockId);
  if (!block) return { ok: false, error: `No block has the id "${blockId}".` };
  const body = html.slice(block.range.from, block.range.to);
  const match = /<img\b[^>]*?\bsrc="([^"]*)"/i.exec(body);
  if (!match) return { ok: false, error: "The block holds no image." };
  const from = block.range.from + match.index + match[0].length - 1 - match[1]!.length;
  return { ok: true, html: html.slice(0, from) + escapeHtml(src) + html.slice(from + match[1]!.length) };
}
