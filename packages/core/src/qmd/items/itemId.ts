// Creates and recognises item ids: `n-` plus a ULID, time-sortable and made without coordination.
// CONTRACT: documents/contracts/qmd-items.md#ids
import { fillRandom } from "../../encoding/index.js";

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
