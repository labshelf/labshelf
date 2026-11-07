/**
 * Copy and paste of HTML deck blocks as source text: a paste gets fresh block and group ids and may shift its geometry by an offset.
 */
import { freeDeckBlockId } from "./deckBlocks.js";
import { applyDeckEdit, type DeckEditResult } from "./deckEdit.js";
import { parseDeck, type DeckBlock, type DeckModel, type DeckRange } from "./deckParse.js";
import { formatDeckSize } from "./deckSizes.js";
import { tokenizeDeckHtml } from "./deckTokens.js";

export interface DeckClip { blocks: string[] }

const BLOCK_ID = /^[a-z][a-z0-9-]{0,39}$/;

/** The exact source of the listed blocks in document order; unknown ids are skipped, null when none is a block. */
export function copyDeckBlocks(html: string, ids: readonly string[], theme?: string): DeckClip | null {
  const model = parseDeck(html, theme === undefined ? {} : { theme }).model;
  const wanted = new Set(ids);
  const blocks = (model?.slides ?? []).flatMap((slide) => slide.blocks).filter((block) => wanted.has(block.id));
  return blocks.length === 0 ? null : { blocks: blocks.map((block) => html.slice(block.range.from, block.range.to)) };
}

/** A model whose only blocks carry the given ids, so freeDeckBlockId avoids every one of them. */
function takenModel(ids: ReadonlySet<string>): DeckModel {
  const none: DeckRange = { from: 0, to: 0 };
  const blocks = [...ids].map((id) => ({ id }) as DeckBlock);
  return { kind: null, version: null, size: null, sizeRange: null, themeLink: null, bodyContentRange: none, slides: [{ index: 0, range: none, contentRange: none, blocks }] };
}

/** Every data-block and data-group value of the text with its value range. */
function idAttributes(text: string): Array<{ name: "data-block" | "data-group"; value: string; range: DeckRange }> {
  const found: Array<{ name: "data-block" | "data-group"; value: string; range: DeckRange }> = [];
  for (const token of tokenizeDeckHtml(text).tokens) {
    if (token.kind !== "start") continue;
    for (const { name, value, valueRange } of token.attributes) {
      if ((name === "data-block" || name === "data-group") && value != null && valueRange) found.push({ name, value, range: valueRange });
    }
  }
  return found;
}

const replaceRanges = (text: string, edits: Array<{ range: DeckRange; text: string }>): string =>
  edits.slice().sort((a, b) => b.range.from - a.range.from).reduce((result, edit) => result.slice(0, edit.range.from) + edit.text + result.slice(edit.range.to), text);

/** The one block of a clip text inside a stand-alone deck of the given size, or null when the text is not exactly one block element. */
function readClipBlock(text: string, size: string): { deck: string; block: DeckBlock } | null {
  if (typeof text !== "string") return null;
  const start = `<html data-deck-size="${size}"><body><section data-slide>`;
  const deck = `${start}${text}</section></body></html>`;
  const parsed = parseDeck(deck);
  const blocks = parsed.model?.slides[0]?.blocks ?? [];
  const from = start.length + (text.length - text.trimStart().length);
  const to = start.length + text.trimEnd().length;
  if (parsed.problems.length > 0 || blocks.length !== 1 || blocks[0]!.range.from !== from || blocks[0]!.range.to !== to) return null;
  return { deck, block: blocks[0]! };
}

/** Shifts a px block's left and top by the offset; a cell block becomes px at its cell rect plus the offset. */
function shifted(deck: string, block: DeckBlock, offset: number): string | null {
  if (offset === 0 || !block.rect) return deck;
  const { left, top, width, height } = block.rect;
  const result = block.cell
    ? applyDeckEdit(deck, { kind: "resize", block: block.id, left: left + offset, top: top + offset, width, height })
    : applyDeckEdit(deck, { kind: "move", block: block.id, left: left + offset, top: top + offset });
  return result.ok ? result.html : null;
}

/** The whitespace and indentation before a range on its line, as a separator. */
function lineIndent(html: string, from: number): string {
  let start = from;
  while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) start--;
  return start > 0 && html[start - 1] === "\n" ? `\n${html.slice(start, from)}` : "";
}

/** Inserts the clip's blocks at the end of the slide's content (before its notes) with fresh block and group ids; offset shifts their geometry. */
export function pasteDeckBlocks(html: string, slide: number, clip: DeckClip, offset: number): { result: DeckEditResult; ids: string[] } {
  const refuse = (error: string) => ({ result: { ok: false as const, error }, ids: [] });
  const model = parseDeck(html).model;
  if (!model) return refuse("The deck has no html element with a body, so it cannot be edited.");
  const target = Number.isInteger(slide) ? model.slides[slide] : undefined;
  if (!target) return refuse(`Slide ${String(slide)} does not exist.`);
  if (!clip || !Array.isArray(clip.blocks) || clip.blocks.length === 0) return refuse("The clipboard holds no block.");
  if (typeof offset !== "number" || !Number.isFinite(offset)) return refuse("The offset must be a finite number.");
  const taken = new Set(idAttributes(html).map((entry) => entry.value));
  const groups = new Map<string, string>();
  const size = model.size ? formatDeckSize(model.size) : "";
  const ids: string[] = [];
  const texts: string[] = [];
  for (const text of clip.blocks) {
    if (!readClipBlock(text, size)) return refuse("Each copied block must be exactly one element with a data-block id.");
    const renames = idAttributes(text).map((entry) => {
      const known = entry.name === "data-group" ? groups.get(entry.value) : undefined;
      const fresh = known ?? freeDeckBlockId(takenModel(taken), entry.name === "data-group" ? "group" : entry.value.replace(/-\d+$/, ""));
      taken.add(fresh);
      if (entry.name === "data-group") groups.set(entry.value, fresh);
      return { range: entry.range, text: fresh };
    });
    const renamed = replaceRanges(text, renames).trim();
    const read = readClipBlock(renamed, size)!;
    if (!BLOCK_ID.test(read.block.id)) return refuse(`The pasted block id "${read.block.id}" is not valid.`);
    const deck = shifted(read.deck, read.block, offset);
    const copy = deck === null ? undefined : parseDeck(deck).model?.slides[0]?.blocks[0];
    if (!deck || !copy) return refuse(`The block "${read.block.id}" could not be moved by the offset.`);
    ids.push(read.block.id);
    texts.push(deck.slice(copy.range.from, copy.range.to));
  }
  const notes = target.notes?.range.from;
  let end = target.contentRange.to;
  while (end > target.contentRange.from && /\s/.test(html[end - 1]!)) end--;
  const at = notes ?? end;
  const first = target.blocks[0];
  const indent = lineIndent(html, notes ?? first?.range.from ?? at);
  const text = notes !== undefined ? texts.map((block) => `${block}${indent}`).join("") : texts.map((block) => `${indent}${block}`).join("");
  return { result: { ok: true, html: html.slice(0, at) + text + html.slice(at) }, ids };
}
