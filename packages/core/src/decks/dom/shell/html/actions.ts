// The deck workspace's edits: inserting text, image, equation and shape blocks, duplicating, deleting, ordering and aligning the
// selection (duplicate and align through arrange.ts), and new slides from a layout; each one undo step through the bare editor.
import { applyDeckEdit } from "../../../deckEdit.js";
import { equationBlockHtml, freeDeckBlockId, imageBlockHtml, reorderDeckBlock, textBlockHtml } from "../../../deckBlocks.js";
import type { DeckBlock, DeckRect } from "../../../deckParse.js";
import { deckCanvasPx } from "../../../deckSizes.js";
import { findDeckBlock, shapeBlockHtml } from "../../../deckStyle.js";
import { alignBlocks, duplicateBlocks } from "./arrange.js";
import type { BlockInsertKind, ShellContext } from "./types.js";

export const canvasOf = (ctx: ShellContext): { width: number; height: number } => (ctx.view.model?.size ? deckCanvasPx(ctx.view.model.size) : { width: 1920, height: 1080 });

/** The one selected block, or undefined. */
export function selectedBlock(ctx: ShellContext): DeckBlock | undefined {
  const { model, slide, blocks } = ctx.view;
  return blocks.length === 1 ? model?.slides[slide]?.blocks.find((block) => block.id === blocks[0]) : undefined;
}

/** A rect of the canvas's share `w` × `h`, centred. */
function centred(ctx: ShellContext, w: number, h: number): DeckRect {
  const canvas = canvasOf(ctx);
  const width = Math.round(canvas.width * w);
  const height = Math.round(canvas.height * h);
  return { left: Math.round((canvas.width - width) / 2), top: Math.round((canvas.height - height) / 2), width, height };
}

async function blockHtml(ctx: ShellContext, kind: BlockInsertKind, id: string): Promise<string | undefined> {
  if (kind === "text") return textBlockHtml(id, centred(ctx, 0.4, 0.12), "Text");
  if (kind === "equation") return equationBlockHtml(id, centred(ctx, 0.3, 0.14), "E = mc^2");
  if (kind === "image") {
    const src = await ctx.options.pickImage?.();
    return src ? imageBlockHtml(id, centred(ctx, 0.4, 0.4), src) : undefined;
  }
  const square = Math.round(Math.min(canvasOf(ctx).width, canvasOf(ctx).height) / 4);
  const rect = centred(ctx, square / canvasOf(ctx).width, kind === "line" ? 8 / canvasOf(ctx).height : square / canvasOf(ctx).height);
  return shapeBlockHtml(id, kind, rect);
}

const ID_PREFIX: Record<BlockInsertKind, string> = { text: "text", image: "image", equation: "equation", rect: "shape", ellipse: "shape", line: "shape" };

/** Adds a block of `kind` in the middle of the current slide and selects it. */
export async function insertBlock(ctx: ShellContext, kind: BlockInsertKind): Promise<void> {
  const id = freeDeckBlockId(ctx.view.model, ID_PREFIX[kind]);
  const html = await blockHtml(ctx, kind, id);
  if (html) ctx.edit([(current) => applyDeckEdit(current, { kind: "addBlock", slide: ctx.view.slide, html })], "Insert block", [id]);
}

/** Duplicates the selected blocks 24 px off as one step (arrange.ts). */
export const duplicateSelected = (ctx: ShellContext): void => duplicateBlocks(ctx);

export function deleteSelected(ctx: ShellContext): void {
  const ids = ctx.view.blocks;
  ctx.edit(ids.map((id) => (html: string) => applyDeckEdit(html, { kind: "deleteBlock", block: id })), "Delete block", []);
}

export function orderSelected(ctx: ShellContext, place: "front" | "back"): void {
  const block = selectedBlock(ctx);
  if (block) ctx.edit([(html) => reorderDeckBlock(html, block.id, place)], place === "front" ? "Bring to front" : "Send to back", [block.id]);
}

export type AlignSide = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Aligns the one selected block on the slide, or several to the selection (arrange.ts). */
export const alignSelected = (ctx: ShellContext, side: AlignSide): void => alignBlocks(ctx, side);

/** Sets the block's rect from panel values in canvas px. */
export function placeBlock(ctx: ShellContext, id: string, rect: DeckRect): void {
  if (Object.values(rect).every(Number.isFinite)) ctx.edit([(html) => applyDeckEdit(html, { kind: "resize", block: id, ...rect })], "Move block", [id]);
}

export type SlideLayout = "title" | "title-text" | "two-columns" | "blank";
export const SLIDE_LAYOUTS: ReadonlyArray<readonly [SlideLayout, string]> = [["title", "Title"], ["title-text", "Title and text"], ["two-columns", "Two columns"], ["blank", "Blank"]];

/** The section of a new slide of `layout`, its block ids free in the deck. */
function slideHtml(ctx: ShellContext, layout: SlideLayout): string {
  const { width, height } = canvasOf(ctx);
  const taken = new Set<string>();
  const id = (prefix: string): string => { let n = 1; while (taken.has(`${prefix}-${n}`) || findDeckBlock(ctx.view.model, `${prefix}-${n}`)) n++; taken.add(`${prefix}-${n}`); return `${prefix}-${n}`; };
  const m = Math.round(width * 0.06);
  const head = { left: m, top: Math.round(height * 0.08), width: width - 2 * m, height: Math.round(height * 0.14) };
  const bodyTop = head.top + head.height + Math.round(height * 0.04);
  const body = { left: m, top: bodyTop, width: width - 2 * m, height: height - bodyTop - Math.round(height * 0.08) };
  const half = (side: 0 | 1): DeckRect => ({ ...body, left: m + side * Math.round(body.width / 2 + m / 4), width: Math.round(body.width / 2 - m / 4) });
  const blocks = layout === "blank" ? [] : layout === "title" ? [textBlockHtml(id("title"), { ...head, top: Math.round(height * 0.4) }, "Title")]
    : layout === "title-text" ? [textBlockHtml(id("title"), head, "Title"), textBlockHtml(id("text"), body, "Text")]
      : [textBlockHtml(id("title"), head, "Title"), textBlockHtml(id("text"), half(0), "Left column"), textBlockHtml(id("text"), half(1), "Right column")];
  return `<section data-slide>\n  ${blocks.join("\n  ")}\n</section>`;
}

/** Adds a slide of `layout` after the current one and shows it. */
export function newSlide(ctx: ShellContext, layout: SlideLayout): void {
  const at = ctx.view.slide + 1;
  ctx.edit([(html) => applyDeckEdit(html, { kind: "addSlide", at, html: slideHtml(ctx, layout) })], "Add slide");
  ctx.editor.selectSlide(at);
}
