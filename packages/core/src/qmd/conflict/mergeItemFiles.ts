// Merges two edited versions of a qmd item file item by item, three-way against their common base when there is one.
// CONTRACT: documents/contracts/qmd-items.md#merge
import {
  isBlankLine,
  lineEnding,
  parseItemFile,
  splitLines,
  type ItemSegment,
  isBalanced,
  unclosedCodeFences,
  formatDivOpener,
  lineContent,
  parseDivOpener,
} from "../items/index.js";
import type { TextMerge, TextMergeResult } from "./textMergePort.js";
import { findOutputs, type OutputBlock } from "../cellOutput/index.js";

/** The side that holds every edit, or undefined when both sides changed the value differently. */
function changedSide<T>(base: T | undefined, local: T, other: T): T | undefined {
  if (local === other || other === base) { return local; }
  if (local === base) { return other; }
  return undefined;
}

// CONTRACT: documents/contracts/qmd-items.md#merge
const START = "";

/**
 * Every key of the three sides once. Items of the base keep base order. Items added on one side follow the base item
 * that precedes them on that side, as one run; when both sides add a run at the same place, the run whose first id is
 * smaller (created earlier) goes first. An item both sides added keeps local's place.
 */
function mergedOrder(base: readonly string[], local: readonly string[], other: readonly string[]): string[] {
  const inBase = new Set(base);
  const localRuns = addedRuns(local, inBase, new Set());
  const otherRuns = addedRuns(other, inBase, new Set(local));
  const order: string[] = [];
  for (const slot of [START, ...base]) {
    if (slot !== START) { order.push(slot); }
    const runs = [localRuns.get(slot) ?? [], otherRuns.get(slot) ?? []].filter((run) => run.length > 0);
    runs.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
    for (const run of runs) { order.push(...run); }
  }
  return order;
}

/** Added keys of one side grouped by the base key before them (START for the file start), skipping `taken` keys. */
function addedRuns(keys: readonly string[], inBase: ReadonlySet<string>, taken: ReadonlySet<string>): Map<string, string[]> {
  const runs = new Map<string, string[]>();
  let slot = START;
  for (const key of keys) {
    if (inBase.has(key)) {
      slot = key;
    } else if (!taken.has(key)) {
      runs.set(slot, [...runs.get(slot) ?? [], key]);
    }
  }
  return runs;
}

/**
 * For each cell with exactly one result on each side and different results, writes the result of the later run into
 * both bodies; a tie keeps the local one.
 */
function settleOutputs(local: string, other: string): { local: string; other: string } {
  const localBlocks = singleBlocks(local);
  const otherBlocks = singleBlocks(other);
  let settledLocal = local;
  let settledOther = other;
  for (const [cell, localBlock] of localBlocks) {
    const otherBlock = otherBlocks.get(cell);
    if (!otherBlock) { continue; }
    const localText = local.slice(localBlock.start, localBlock.end);
    const otherText = other.slice(otherBlock.start, otherBlock.end);
    if (localText === otherText) { continue; }
    if ((otherBlock.ran ?? "") > (localBlock.ran ?? "")) {
      settledLocal = settledLocal.replace(localText, () => otherText);
    } else {
      settledOther = settledOther.replace(otherText, () => localText);
    }
  }
  return { local: settledLocal, other: settledOther };
}

function singleBlocks(body: string): Map<string, OutputBlock> {
  const blocks = new Map<string, OutputBlock>();
  const repeated = new Set<string>();
  for (const block of findOutputs(body)) {
    if (blocks.has(block.cell)) { repeated.add(block.cell); }
    blocks.set(block.cell, block);
  }
  for (const cell of repeated) { blocks.delete(cell); }
  return blocks;
}

/**
 * Takes each attribute and class from the side that changed it. When both changed an attribute differently, the
 * local value stays, unless local removed it: an edit beats a removal.
 */
function mergeOpeners(base: string | undefined, local: string, other: string): string {
  const parse = (line: string | undefined) => (line === undefined ? undefined : parseDivOpener(lineContent(line)));
  const [baseAttrs, localAttrs, otherAttrs] = [parse(base), parse(local), parse(other)];
  if (!localAttrs || !otherAttrs) { return local; }
  const baseClasses = new Set(baseAttrs?.classes ?? []);
  const classes = [...new Set([...localAttrs.classes, ...otherAttrs.classes])].filter((name) => {
    const inLocal = localAttrs.classes.includes(name);
    return inLocal === otherAttrs.classes.includes(name) || inLocal !== baseClasses.has(name) ? inLocal : !inLocal;
  });
  const baseValues = new Map(baseAttrs?.pairs.map(([key, value]) => [key, value]));
  const localValues = new Map(localAttrs.pairs.map(([key, value]) => [key, value]));
  const otherValues = new Map(otherAttrs.pairs.map(([key, value]) => [key, value]));
  const pairs: [string, string][] = [];
  for (const key of new Set([...localValues.keys(), ...otherValues.keys()])) {
    const value = mergeValue(baseValues.get(key), localValues.get(key), otherValues.get(key));
    if (value !== undefined) { pairs.push([key, value]); }
  }
  const id = localAttrs.id;
  return formatDivOpener(id === undefined ? { classes, pairs } : { id, classes, pairs }) + lineEnding(local);
}

function mergeValue(base: string | undefined, local: string | undefined, other: string | undefined): string | undefined {
  if (local === other || other === base) { return local; }
  if (local === base) { return other; }
  return local ?? other;
}

/** The bytes of a merged item, written as they are. */
type ItemText = Pick<ItemSegment, "fence" | "body" | "close">;

export interface ItemMergeResult {
  readonly items: readonly ItemText[];
  readonly conflicted: boolean;
}

/**
 * Both-sided body edits merge line by line, with conflict markers inside the body only. When the merged body would
 * open or close a fence it does not close or open, both versions are kept as two items with the same id.
 */
function mergeItem(
  base: ItemSegment | undefined, local: ItemSegment, other: ItemSegment, textMerge: TextMerge, otherLabel: string,
): ItemMergeResult {
  const fence = changedSide(base?.fence, local.fence, other.fence) ?? mergeOpeners(base?.fence, local.fence, other.fence);
  const settled = settleOutputs(local.body, other.body);
  const body = changedSide(base?.body, settled.local, settled.other);
  if (body !== undefined) { return { items: [{ fence, body, close: local.close }], conflicted: false }; }
  const merged = textMerge({ base: base?.body ?? "", local: settled.local, other: settled.other, otherLabel });
  const text = merged.text === "" || /[\r\n]$/.test(merged.text) ? merged.text : merged.text + lineEnding(local.fence);
  const lines = splitLines(text);
  if (!isBalanced(lines) || unclosedCodeFences(lines).length > 0) {
    return { items: [local, other], conflicted: true };
  }
  return { items: [{ fence, body: text, close: local.close }], conflicted: merged.conflicted };
}

export interface ItemFileMergeInput {
  /** The common ancestor; without it the merge is a union by id that never honours a delete. */
  readonly base?: string;
  readonly local: string;
  readonly other: string;
  readonly otherLabel: string;
}

/** One side as items by key and the loose text after each key; key "" is the file start. */
interface Side {
  readonly keys: readonly string[];
  readonly items: ReadonlyMap<string, ItemSegment>;
  readonly gaps: ReadonlyMap<string, string>;
}

interface Piece { readonly text: string; readonly item?: { readonly id: string; readonly added: boolean } }

/**
 * Items both sides kept merge with `mergeItem`; an item on one side only is kept when it is new or edited there, and
 * dropped when the other side deleted it unchanged. Loose text after the same item merges line by line.
 * @throws when the merged text would read as different items than merged, so the caller keeps both files.
 */
export function mergeItemFiles(input: ItemFileMergeInput, textMerge: TextMerge): TextMergeResult {
  const local = readSide(input.local);
  const other = readSide(input.other);
  const base = commonBase(readSide(input.base ?? ""), local, other);
  let conflicted = false;
  const merge = (b: string, l: string, o: string): string => {
    const picked = changedSide(b, l, o);
    if (picked !== undefined) { return picked; }
    const merged = textMerge({ base: b, local: l, other: o, otherLabel: input.otherLabel });
    conflicted ||= merged.conflicted;
    return merged.text;
  };
  const pieces: Piece[] = [{ text: merge(base.gaps.get("") ?? "", local.gaps.get("") ?? "", other.gaps.get("") ?? "") }];
  for (const key of mergedOrder(base.keys, local.keys, other.keys)) {
    const result = mergeKey(key, base, local, other, (b, l, o) => mergeItem(b, l, o, textMerge, input.otherLabel));
    conflicted ||= result.conflicted;
    for (const [index, item] of result.items.entries()) {
      pieces.push({ text: item.fence + item.body + item.close, item: { id: idOf(key), added: !base.items.has(key) || index > 0 } });
    }
    pieces.push({ text: merge(base.gaps.get(key) ?? "", local.gaps.get(key) ?? "", other.gaps.get(key) ?? "") });
  }
  return { text: joinPieces(pieces, lineEnding(input.local)), conflicted };
}

const NO_BASE: Side = { keys: [], items: new Map(), gaps: new Map() };

/**
 * The base, or none when a side shares no item with it: the base is this device's first sight of the file, and a side
 * created apart from it would otherwise lose every item the base holds.
 */
function commonBase(base: Side, local: Side, other: Side): Side {
  const shares = (side: Side) => side.keys.some((key) => base.items.has(key));
  return base.keys.length === 0 || (shares(local) && shares(other)) ? base : NO_BASE;
}

function mergeKey(
  key: string, base: Side, local: Side, other: Side,
  both: (b: ItemSegment | undefined, l: ItemSegment, o: ItemSegment) => { items: readonly ItemText[]; conflicted: boolean },
): { items: readonly ItemText[]; conflicted: boolean } {
  const [b, l, o] = [base.items.get(key), local.items.get(key), other.items.get(key)];
  if (l && o) { return both(b, l, o); }
  const kept = l ?? o;
  // An item missing on one side was deleted there; an edit on the other side beats the delete.
  if (!kept || (b && textOf(b) === textOf(kept))) { return { items: [], conflicted: false }; }
  return { items: [kept], conflicted: false };
}

function readSide(text: string): Side {
  const keys: string[] = [];
  const items = new Map<string, ItemSegment>();
  const gaps = new Map<string, string>();
  const seen = new Map<string, number>();
  let last = "";
  for (const segment of parseItemFile(text).segments) {
    if (segment.kind === "loose") { gaps.set(last, segment.text); continue; }
    const count = (seen.get(segment.id) ?? 0) + 1;
    seen.set(segment.id, count);
    // A hand edit can repeat an id; each repeat is its own item, matched by its rank among items with that id.
    last = count === 1 ? segment.id : `${segment.id}\u0000${count}`;
    keys.push(last);
    items.set(last, segment);
  }
  return { keys, items, gaps };
}

/** Joins the pieces as they are, or with separating lines when that is what keeps every item an item. */
function joinPieces(pieces: readonly Piece[], eol: string): string {
  const expected = pieces.flatMap((piece) => (piece.item ? [piece.item.id] : []));
  for (const separate of [false, true]) {
    const text = join(pieces, eol, separate);
    const read = parseItemFile(text).segments.flatMap((segment) => (segment.kind === "item" ? [segment.id] : []));
    if (read.length === expected.length && read.every((id, index) => id === expected[index])) { return text; }
  }
  throw new Error(`Merged item file would not read as the ${expected.length} merged items`);
}

function join(pieces: readonly Piece[], eol: string, separate: boolean): string {
  let out = "";
  let previous: Piece | undefined;
  for (const piece of pieces) {
    if (piece.text === "") { continue; }
    if (out !== "" && !/[\r\n]$/.test(out)) { out += eol; }
    if (piece.item && previous) {
      const afterAddedItem = previous.item && (previous.item.added || piece.item.added);
      if (afterAddedItem || (separate && !previous.item && !isBlankLine(splitLines(previous.text).at(-1) ?? ""))) { out += eol; }
    }
    out += piece.text;
    previous = piece;
  }
  return out;
}

function idOf(key: string): string {
  return key.split("\u0000")[0]!;
}

/** The item's bytes without the final line ending, which appending after the item adds. */
function textOf(item: ItemSegment): string {
  return item.fence + item.body + item.close.replace(/(?:\r\n|\n|\r)$/, "");
}
