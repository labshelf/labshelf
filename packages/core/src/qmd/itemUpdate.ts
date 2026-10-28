// Creates item ids and adds, rewrites and removes items of a parsed item file, changing only the bytes of the item edited.
// CONTRACT: documents/contracts/qmd-items.md#ids
import { fillRandom } from "../encoding/index.js";
import {
  ITEM_CLASS,
  extractLineEnding,
  findUnclosedCodeFences,
  formatAnchor,
  formatDivOpener,
  isBalanced,
  isBlankLine,
  parseAnchor,
  parseItemFile,
  serializeItemFile,
  splitLines,
  type ItemAnchor,
  type ItemFile,
  type ItemSegment,
  type Segment,
} from "./itemFile.js";

// ---- Ids

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const MAX_TIME = 2 ** 48 - 1;
const ITEM_ID = /^n-[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

/** Returns an id generator whose ids increase also within one millisecond of `now`. */
export function createItemIdGenerator(now: () => number = Date.now, random: RandomBytes = fillRandom): () => string {
  let lastTime = -1;
  let lastRandom: number[] = [];
  return () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time > MAX_TIME) { throw new Error(`Item id: clock value out of range (${time})`); }
    lastRandom = time === lastTime ? increment(lastRandom) : randomDigits(random);
    lastTime = time;
    return `n-${encodeTime(time)}${lastRandom.map((digit) => CROCKFORD[digit]).join("")}`;
  };
}

export const newItemId: () => string = createItemIdGenerator();

export function isItemId(text: string): boolean {
  return ITEM_ID.test(text);
}

function encodeTime(time: number): string {
  let out = "";
  let rest = time;
  for (let i = 0; i < TIME_CHARS; i++) {
    out = CROCKFORD[rest % 32]! + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function randomDigits(random: RandomBytes): number[] {
  const bytes = random(new Uint8Array(10));
  const digits: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      digits.push((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return digits;
}

function increment(digits: readonly number[]): number[] {
  const next = [...digits];
  for (let i = RANDOM_CHARS - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error("Item id: random part overflowed within one millisecond");
}

// ---- Updates

export interface CreateItemInput {
  readonly id: string;
  readonly anchor?: ItemAnchor;
  readonly author?: string;
  readonly created?: string;
  readonly body: string;
}

/** Appends an item at the end of the file, after one empty line. Throws on an invalid or taken id or an unsafe body. */
export function addItem(file: ItemFile, item: CreateItemInput): ItemFile {
  if (!isItemId(item.id)) { throw new Error(`Item id "${item.id}" is not n- plus a ULID`); }
  if (file.segments.some((segment) => segment.kind === "item" && segment.id === item.id)) {
    throw new Error(`Item ${item.id} already exists in the file`);
  }
  const text = serializeItemFile(file);
  const eol = extractLineEnding(text);
  const segments = [...file.segments];
  const last = segments.at(-1);
  if (last && !/(?:\r\n|\n|\r)$/.test(text)) {
    segments[segments.length - 1] = last.kind === "loose" ? { ...last, text: last.text + eol } : { ...last, close: last.close + eol };
  }
  const lastLine = splitLines(serializeItemFile({ segments })).at(-1);
  if (lastLine !== undefined && !isBlankLine(lastLine)) {
    segments.push({ kind: "loose", text: eol });
  }
  segments.push(newSegment(item, eol));
  return checked({ segments: joinLoose(segments) }, item.id);
}

/** Throws when no item or more than one has the id, or the body is unsafe. */
export function setItemBody(file: ItemFile, id: string, body: string): ItemFile {
  const index = indexOfItem(file, id);
  const eol = extractLineEnding(serializeItemFile(file));
  const segments = [...file.segments];
  segments[index] = { ...(segments[index] as ItemSegment), body: prepareBody(id, body, eol) };
  return checked({ segments }, id);
}

/** Removes the item and the empty line that separated it, never other loose text. Throws when the id is not unique. */
export function removeItem(file: ItemFile, id: string): ItemFile {
  const index = indexOfItem(file, id);
  const segments = [...file.segments];
  segments.splice(index, 1);
  const before = segments[index - 1];
  const after = segments[index];
  if (before?.kind === "loose" && /^\s*$/.test(before.text) && /(?:\r\n|\n|\r)$/.test(before.text)) {
    segments[index - 1] = { kind: "loose", text: before.text.replace(/(?:\r\n|\n|\r)$/, "") };
  } else if (after?.kind === "loose" && /^\s*$/.test(after.text)) {
    segments[index] = { kind: "loose", text: after.text.replace(/^(?:\r\n|\n|\r)/, "") };
  }
  return { segments: joinLoose(segments) };
}

function newSegment(item: CreateItemInput, eol: string): ItemSegment {
  const attrs: [string, string][] = [];
  const anchor = item.anchor ? formatAnchor(item.anchor) : "";
  if (anchor !== "") { attrs.push(["anchor", anchor]); }
  if (item.author) { attrs.push(["author", item.author]); }
  if (item.created) { attrs.push(["created", item.created]); }
  return {
    kind: "item",
    id: item.id,
    anchor: parseAnchor(anchor),
    ...(item.author ? { author: item.author } : {}),
    ...(item.created ? { created: item.created } : {}),
    classes: [ITEM_CLASS],
    attrs,
    fence: formatDivOpener({ id: item.id, classes: [ITEM_CLASS], pairs: attrs }) + eol,
    body: prepareBody(item.id, item.body, eol),
    close: `:::${eol}`,
  };
}

/** Converts the body to the file's line ending and rejects one that would end the item early or leave a fence open. */
function prepareBody(id: string, body: string, eol: string): string {
  let prepared = body.replace(/\r\n|\n|\r/g, eol);
  if (prepared !== "" && !prepared.endsWith(eol)) { prepared += eol; }
  const lines = splitLines(prepared);
  const unclosed = findUnclosedCodeFences(lines);
  if (unclosed.length > 0) { throw new Error(`Item ${id}: body has an unclosed code fence at line ${unclosed[0]! + 1}`); }
  if (!isBalanced(lines)) { throw new Error(`Item ${id}: body opens or closes a div it does not close or open`); }
  return prepared;
}

/**
 * Rejects an edit after which the file reads differently from the segments meant: a code fence in the new body can
 * pair with an unclosed fence elsewhere in the file and turn the items between them into loose text.
 */
function checked(file: ItemFile, id: string): ItemFile {
  const reread = parseItemFile(serializeItemFile(file)).segments;
  const same = reread.length === file.segments.length && reread.every((segment, index) => {
    const meant = file.segments[index]!;
    return segment.kind === meant.kind && serializeItemFile({ segments: [segment] }) === serializeItemFile({ segments: [meant] })
      && (segment.kind === "loose" || segment.id === (meant as ItemSegment).id);
  });
  if (!same) { throw new Error(`Item ${id}: the edit would change how other parts of the file read, for example through a code fence`); }
  return file;
}

function indexOfItem(file: ItemFile, id: string): number {
  const indices = file.segments.flatMap((segment, index) => (segment.kind === "item" && segment.id === id ? [index] : []));
  if (indices.length !== 1) { throw new Error(`Item ${id}: found ${indices.length} items with this id, expected 1`); }
  return indices[0]!;
}

function joinLoose(segments: readonly Segment[]): Segment[] {
  const joined: Segment[] = [];
  for (const segment of segments) {
    const previous = joined.at(-1);
    if (segment.kind === "loose" && segment.text === "") { continue; }
    if (segment.kind === "loose" && previous?.kind === "loose") {
      joined[joined.length - 1] = { kind: "loose", text: previous.text + segment.text };
    } else {
      joined.push(segment);
    }
  }
  return joined;
}
