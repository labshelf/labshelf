// The deck workspace's arrange actions on the selection (A8): copy, paste and duplicate through one in-memory clipboard per page,
// group and ungroup, align and distribute; each one undo step through the bare editor. Nothing is written to the system clipboard.
import { alignDeckBlocks, distributeDeckBlocks, type DeckAlignSide, type DeckItem } from "../../../deckAlign.js";
import { freeDeckBlockId } from "../../../deckBlocks.js";
import { copyDeckBlocks, pasteDeckBlocks, type DeckClip } from "../../../deckClipboard.js";
import { applyDeckEdit, type DeckEdit } from "../../../deckEdit.js";
import type { DeckBlock, DeckRect } from "../../../deckParse.js";
import { deckCanvasPx } from "../../../deckSizes.js";
import type { ShellContext } from "./types.js";

/** The offset of a paste or duplicate that would land on its source. */
const PASTE_OFFSET = 24;

/** The clipped blocks' source and their rects at copy time, shared by every editor in the page. */
let clipboard: { clip: DeckClip; rects: DeckRect[] } | null = null;

/** The selected blocks of the current slide, in slide order. */
function selection(ctx: ShellContext): DeckBlock[] {
  const { model, slide, blocks } = ctx.view;
  return (model?.slides[slide]?.blocks ?? []).filter((block) => blocks.includes(block.id));
}

/** The selected blocks with a rect as align units (a group moves as one). */
function items(ctx: ShellContext): DeckItem[] {
  return selection(ctx).flatMap((block) => (block.rect ? [{ id: block.id, rect: block.rect, ...(block.group ? { group: block.group } : {}) }] : []));
}

const canvas = (ctx: ShellContext): { width: number; height: number } => (ctx.view.model?.size ? deckCanvasPx(ctx.view.model.size) : { width: 1920, height: 1080 });

const sameRect = (a: DeckRect, b: DeckRect): boolean => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/** The clip of the selected blocks and their rects, or null when nothing is selected. */
function clipSelection(ctx: ShellContext): { clip: DeckClip; rects: DeckRect[] } | null {
  const blocks = selection(ctx);
  const clip = blocks.length === 0 ? null : copyDeckBlocks(ctx.view.html, blocks.map((block) => block.id), ctx.view.theme);
  return clip ? { clip, rects: blocks.flatMap((block) => (block.rect ? [block.rect] : [])) } : null;
}

/** Inserts a clip into the current slide as one step labelled `label` and selects the pasted blocks. */
function paste(ctx: ShellContext, entry: { clip: DeckClip; rects: DeckRect[] }, offset: number, label: string): void {
  const slide = ctx.view.slide;
  const { ids } = pasteDeckBlocks(ctx.view.html, slide, entry.clip, offset);
  ctx.edit([(html) => pasteDeckBlocks(html, slide, entry.clip, offset).result], label, ids);
}

export function copySelected(ctx: ShellContext): void {
  const entry = clipSelection(ctx);
  if (entry) clipboard = entry;
}

/** Pastes the clipboard into the current slide, 24 px off when a clipped block's rect is already there. */
export function pasteClipboard(ctx: ShellContext): void {
  if (!clipboard) return;
  const rects = clipboard.rects;
  const taken = (ctx.view.model?.slides[ctx.view.slide]?.blocks ?? []).some((block) => block.rect && rects.some((rect) => sameRect(rect, block.rect!)));
  paste(ctx, clipboard, taken ? PASTE_OFFSET : 0, "Paste");
}

/** Copies the selection without touching the clipboard and pastes it 24 px off. */
export function duplicateBlocks(ctx: ShellContext): void {
  const entry = clipSelection(ctx);
  if (entry) paste(ctx, entry, PASTE_OFFSET, "Duplicate");
}

export function groupSelected(ctx: ShellContext): void {
  const ids = selection(ctx).map((block) => block.id);
  if (ids.length < 2) return;
  const group = freeDeckBlockId(ctx.view.model, "group");
  ctx.edit([(html) => applyDeckEdit(html, { kind: "group", blocks: ids, group })], "Group", ids);
}

/** The groups among the selected blocks. */
export const selectedGroups = (ctx: ShellContext): string[] => [...new Set(selection(ctx).flatMap((block) => (block.group ? [block.group] : [])))];

export function ungroupSelected(ctx: ShellContext): void {
  const groups = selectedGroups(ctx);
  if (groups.length > 0) ctx.edit(groups.map((group) => (html: string) => applyDeckEdit(html, { kind: "ungroup", group })), "Ungroup", ctx.view.blocks);
}

/** The number of align units of the selection: one per group, one per ungrouped block. */
export function unitCount(ctx: ShellContext): number {
  const list = items(ctx);
  return new Set(list.map((item) => item.group ?? `#${item.id}`)).size;
}

function commit(ctx: ShellContext, edits: DeckEdit[], label: string): void {
  if (edits.length > 0) ctx.edit(edits.map((edit) => (html: string) => applyDeckEdit(html, edit)), label, ctx.view.blocks);
}

/** One unit aligns on the slide, several to the union of the selection. */
export function alignBlocks(ctx: ShellContext, side: DeckAlignSide): void {
  const list = items(ctx);
  commit(ctx, alignDeckBlocks(list, side, canvas(ctx)), list.length > 1 ? "Align blocks" : "Align block");
}

export function distributeBlocks(ctx: ShellContext, axis: "x" | "y"): void {
  commit(ctx, distributeDeckBlocks(items(ctx), axis), "Distribute blocks");
}
