// QR code encoder: UTF-8 text in byte mode, error correction level M, versions 1 to 10, mask by penalty.
import { QR_MAX_VERSION, qrAddEccAndInterleave, qrAlignmentPositions, qrDataCodewords } from "./qrTables.js";

const TOO_LONG = "Text is too long for a QR code (213 bytes at most).";
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function byteCapacity(version: number): number {
  return Math.floor((qrDataCodewords(version) * 8 - 4 - countBits(version)) / 8);
}

/** Smallest version 1..10 whose level-M byte-mode capacity holds `byteLength` bytes. */
export function qrVersionFor(byteLength: number): number {
  for (let version = 1; version <= QR_MAX_VERSION; version++) {
    if (byteLength <= byteCapacity(version)) return version;
  }
  throw new RangeError(TOO_LONG);
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, countBits(version));
  for (const byte of bytes) append(byte, 8);
  const capacity = qrDataCodewords(version) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const result: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    result.push(byte);
  }
  return result;
}

interface Grid {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

function setFunction(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.modules[y]![x] = dark;
  grid.isFunction[y]![x] = true;
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function drawFormatBits(grid: Grid, mask: number): void {
  const data = mask; // level M has the format bits 00 above the mask
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const { size } = grid;
  for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(bits, i));
  setFunction(grid, 8, 7, bit(bits, 6));
  setFunction(grid, 8, 8, bit(bits, 7));
  setFunction(grid, 7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) setFunction(grid, size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) setFunction(grid, 8, size - 15 + i, bit(bits, i));
  setFunction(grid, 8, size - 8, true); // dark module
}

function drawVersionBits(grid: Grid, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, a, b, bit(bits, i));
    setFunction(grid, b, a, bit(bits, i));
  }
}

function drawFinder(grid: Grid, x: number, y: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && xx < grid.size && yy >= 0 && yy < grid.size) {
        setFunction(grid, xx, yy, distance !== 2 && distance !== 4);
      }
    }
  }
}

function drawAlignment(grid: Grid, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(grid, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const { size } = grid;
  for (let i = 0; i < size; i++) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  const positions = qrAlignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((py, i) => {
    positions.forEach((px, j) => {
      const corner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!corner) drawAlignment(grid, px, py);
    });
  });
  drawFormatBits(grid, 0); // reserves the area; redrawn with the chosen mask
  drawVersionBits(grid, version);
}

function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const { size } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = upward ? size - 1 - vertical : vertical;
        if (!grid.isFunction[y]![x] && i < codewords.length * 8) {
          grid.modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** XORs the mask over the non-function modules; applying it twice undoes it. */
function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.isFunction[y]![x] && maskApplies(mask, x, y)) grid.modules[y]![x] = !grid.modules[y]![x];
    }
  }
}

function addRunHistory(length: number, history: number[], size: number): void {
  if (history[0] === 0) length += size; // a leading light run borders the light quiet zone
  history.pop();
  history.unshift(length);
}

/** Counts the 1:1:3:1:1 finder-like runs with 4 light modules on one side in the latest run history. */
function countFinderLike(history: readonly number[]): number {
  const n = history[1]!;
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (
    (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) + (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0)
  );
}

/** N1 and N3 penalties of one row or column. */
function linePenalty(line: (i: number) => boolean, size: number): number {
  let result = 0;
  let runDark = false;
  let runLength = 0;
  const history = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < size; i++) {
    if (line(i) === runDark) {
      runLength++;
      if (runLength === 5) result += PENALTY_N1;
      else if (runLength > 5) result++;
    } else {
      addRunHistory(runLength, history, size);
      if (!runDark) result += countFinderLike(history) * PENALTY_N3;
      runDark = line(i);
      runLength = 1;
    }
  }
  if (runDark) {
    addRunHistory(runLength, history, size);
    runLength = 0;
  }
  addRunHistory(runLength + size, history, size);
  return result + countFinderLike(history) * PENALTY_N3;
}

function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let result = 0;
  for (let y = 0; y < size; y++) result += linePenalty((x) => modules[y]![x]!, size);
  for (let x = 0; x < size; x++) result += linePenalty((y) => modules[y]![x]!, size);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = modules[y]![x]!;
      if (color) dark++;
      if (
        y < size - 1 &&
        x < size - 1 &&
        color === modules[y]![x + 1] &&
        color === modules[y + 1]![x] &&
        color === modules[y + 1]![x + 1]
      ) {
        result += PENALTY_N2;
      }
    }
  }
  const total = size * size;
  const steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + steps * PENALTY_N4;
}

/** Encodes `text` as a QR code; returns a fresh matrix[row][column], true for dark. */
export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = qrVersionFor(bytes.length);
  const size = version * 4 + 17;
  const grid: Grid = {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    isFunction: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, qrAddEccAndInterleave(dataCodewords(bytes, version), version));
  let best = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(grid, mask);
    drawFormatBits(grid, mask);
    const score = penalty(grid.modules);
    if (score < bestPenalty) {
      best = mask;
      bestPenalty = score;
    }
    applyMask(grid, mask);
  }
  applyMask(grid, best);
  drawFormatBits(grid, best);
  return grid.modules;
}
