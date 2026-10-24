// Merges two edited versions of a qmd item file item by item, three-way against their common base when there is one.
// CONTRACT: documents/contracts/qmd-items.md#merge
import { isBlankLine, lineEnding, parseItemFile, splitLines, type ItemSegment } from "../items/index.js";
import { mergeItem, type ItemText } from "./itemMerge.js";
import { mergedOrder } from "./itemOrder.js";
import { changedSide } from "./sideChange.js";
import type { TextMerge, TextMergeResult } from "./textMergePort.js";

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
