// Shared QR test harness: a small ISO/IEC 18004 decoder (byte mode, level M, versions 1-10), the spec tables and the sample texts.
export type Matrix = readonly (readonly boolean[])[];

export const TOO_LONG = "Text is too long for a QR code (213 bytes at most).";

/** Byte-mode capacity at level M of versions 1..10. */
export const CAPACITY = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
/** Total codewords (data + EC) of versions 1..10. */
export const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
/** Level M per version 1..10: EC codewords per block and block groups as [block count, data codewords per block]. */
export const M_BLOCKS: readonly { ec: number; groups: readonly (readonly [number, number])[] }[] = [
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
  { ec: 26, groups: [[4, 43], [1, 44]] },
];
/** Alignment pattern center coordinates of versions 1..10. */
export const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
/** Version information words (ISO/IEC 18004 Annex D). */
export const VERSION_INFO: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
/** Format information words for level M, masks 0..7 (ISO/IEC 18004 Annex C), already XORed with 0x5412. */
export const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

export const cell = (m: Matrix, r: number, c: number): boolean => m[r]![c]!;
export const sizeOf = (version: number) => 17 + 4 * version;
export const utf8 = (text: string): number[] => Array.from(Buffer.from(text, "utf8"));

/** Deterministic printable text of `length` characters from `alphabet`. */
export function sample(length: number, seed: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -_.~!$&'()*+,;=:@/?"): string {
  let state = seed * 7919 + 17;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[Math.floor((state / 2147483648) * alphabet.length)];
  }
  return out;
}

// ---- BCH words ----

export function formatWord(mask: number): number {
  const data = (0b00 << 3) | mask; // level M is 00
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) & 1 ? 0x537 : 0);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

export function versionWord(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) & 1 ? 0x1f25 : 0);
  return (version << 12) | (rem & 0xfff);
}

// ---- layout ----

/** [row, column] of format bit i (bit 0 = least significant) in the first and second copy. */
export function formatPositions(size: number): { first: [number, number][]; second: [number, number][] } {
  const first: [number, number][] = [];
  const second: [number, number][] = [];
  for (let i = 0; i < 15; i += 1) {
    if (i <= 5) first.push([i, 8]);
    else if (i === 6) first.push([7, 8]);
    else if (i === 7) first.push([8, 8]);
    else if (i === 8) first.push([8, 7]);
    else first.push([8, 14 - i]);
    second.push(i < 8 ? [8, size - 1 - i] : [size - 15 + i, 8]);
  }
  return { first, second };
}

export const readWord = (m: Matrix, positions: [number, number][]) => positions.reduce((word, [r, c], i) => word | ((cell(m, r, c) ? 1 : 0) << i), 0);

export function alignmentCenters(version: number): [number, number][] {
  const coords = ALIGNMENT[version - 1]!;
  const last = coords[coords.length - 1];
  const centers: [number, number][] = [];
  for (const r of coords) {
    for (const c of coords) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      centers.push([r, c]);
    }
  }
  return centers;
}

/** true where a module belongs to a function pattern (finder, separator, timing, alignment, format, dark module, version). */
export function functionModules(version: number): boolean[][] {
  const size = sizeOf(version);
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r0: number, c0: number, h: number, w: number) => {
    for (let r = r0; r < r0 + h; r += 1) for (let c = c0; c < c0 + w; c += 1) map[r]![c] = true;
  };
  mark(0, 0, 9, 9);
  mark(0, size - 8, 9, 8);
  mark(size - 8, 0, 8, 9);
  mark(6, 0, 1, size);
  mark(0, 6, size, 1);
  for (const [r, c] of alignmentCenters(version)) mark(r - 2, c - 2, 5, 5);
  if (version >= 7) {
    mark(0, size - 11, 6, 3);
    mark(size - 11, 0, 3, 6);
  }
  return map;
}

export function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

/** The mask named by the first format copy, or -1 when it is not a level-M format word. */
export function maskOf(m: Matrix): number {
  return FORMAT_M.indexOf(readWord(m, formatPositions(m.length).first));
}

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----

export const EXP = new Array<number>(512).fill(0);
export const LOG = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
}
export const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** EC codewords of `data`: remainder of data(x)·x^n by the generator with roots α^0..α^(n-1). */
export function reedSolomon(data: readonly number[], n: number): number[] {
  let gen = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((g, j) => {
      next[j] = next[j]! ^ g;
      next[j + 1] = next[j + 1]! ^ gfMul(g, EXP[i]!);
    });
    gen = next;
  }
  const msg = [...data, ...new Array<number>(n).fill(0)];
  for (let i = 0; i < data.length; i += 1) {
    const coef = msg[i]!;
    if (coef === 0) continue;
    for (let j = 0; j <= n; j += 1) msg[i + j] = msg[i + j]! ^ gfMul(gen[j]!, coef);
  }
  return msg.slice(data.length);
}

// ---- decoder ----

export function readCodewords(m: Matrix, version: number, mask: number): number[] {
  const size = m.length;
  const fn = functionModules(version);
  const total = TOTAL_CODEWORDS[version - 1]!;
  const bytes = new Array<number>(total).fill(0);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        const r = upward ? size - 1 - vert : vert;
        if (fn[r]![c] || i >= total * 8) continue;
        if (cell(m, r, c) !== maskBit(mask, r, c)) bytes[i >>> 3] = bytes[i >>> 3]! | (1 << (7 - (i & 7)));
        i += 1;
      }
    }
  }
  if (i !== total * 8) throw new Error(`decoder: read ${i} bits, expected ${total * 8}`);
  return bytes;
}

export function deinterleave(codewords: readonly number[], version: number): { data: number[]; ec: number[] }[] {
  const { ec, groups } = M_BLOCKS[version - 1]!;
  const lengths = groups.flatMap(([count, data]) => new Array<number>(count).fill(data));
  const blocks = lengths.map(() => ({ data: [] as number[], ec: [] as number[] }));
  let k = 0;
  for (let i = 0; i < Math.max(...lengths); i += 1) lengths.forEach((len, b) => i < len && blocks[b]!.data.push(codewords[k++]!));
  for (let i = 0; i < ec; i += 1) blocks.forEach((block) => block.ec.push(codewords[k++]!));
  if (k !== codewords.length) throw new Error(`decoder: block table uses ${k} of ${codewords.length} codewords`);
  return blocks;
}

export function parseByteMode(data: readonly number[], version: number): number[] {
  let pos = 0;
  const read = (bits: number) => {
    let v = 0;
    for (let i = 0; i < bits; i += 1, pos += 1) v = (v << 1) | ((data[pos >>> 3]! >>> (7 - (pos & 7))) & 1);
    return v;
  };
  const capacity = data.length * 8;
  const mode = read(4);
  if (mode !== 0b0100) throw new Error(`mode indicator is ${mode.toString(2).padStart(4, "0")}, expected 0100 (byte)`);
  const count = read(version <= 9 ? 8 : 16);
  if (pos + count * 8 > capacity) throw new Error(`character count ${count} overflows the data capacity`);
  const bytes: number[] = [];
  for (let i = 0; i < count; i += 1) bytes.push(read(8));
  if (pos < capacity) {
    const terminator = read(Math.min(4, capacity - pos));
    if (terminator !== 0) throw new Error("terminator is not 0000");
    while (pos % 8 !== 0) if (read(1) !== 0) throw new Error("bit padding is not zero");
    for (let i = 0; pos < capacity; i += 1) {
      const pad = read(8);
      const want = i % 2 === 0 ? 0xec : 0x11;
      if (pad !== want) throw new Error(`pad codeword ${i} is 0x${pad.toString(16)}, expected 0x${want.toString(16)}`);
    }
  }
  return bytes;
}

/** Decodes a level-M byte-mode symbol; throws on any structural, Reed-Solomon or bitstream error. */
export function decode(m: Matrix): { version: number; mask: number; bytes: number[] } {
  const version = (m.length - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10) throw new Error(`size ${m.length} is not a version 1..10 symbol`);
  const mask = maskOf(m);
  if (mask < 0) throw new Error("format information is not a level-M word");
  const blocks = deinterleave(readCodewords(m, version, mask), version);
  blocks.forEach((block, b) => {
    expect({ block: b, ec: block.ec }).toEqual({ block: b, ec: reedSolomon(block.data, block.ec.length) });
  });
  return { version, mask, bytes: parseByteMode(blocks.flatMap((block) => block.data), version) };
}

// ---- penalty (N1..N4) ----

export function lines(m: Matrix): boolean[][] {
  const size = m.length;
  const rows = m.map((row) => [...row]);
  const columns = Array.from({ length: size }, (_, c) => Array.from({ length: size }, (_, r) => cell(m, r, c)));
  return [...rows, ...columns];
}

export function penaltyN1N2N4(m: Matrix): number {
  const size = m.length;
  let score = 0;
  for (const line of lines(m)) {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
  }
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = cell(m, r, c);
      if (cell(m, r, c + 1) === v && cell(m, r + 1, c) === v && cell(m, r + 1, c + 1) === v) score += 3;
    }
  }
  const darkCount = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const percent = (darkCount * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

export const FINDER = [true, false, true, true, true, false, true];
export const LIGHT4 = [false, false, false, false];
export const sameAs = (line: readonly boolean[], at: number, pattern: readonly boolean[]) => pattern.every((v, k) => line[at + k] === v);

/**
 * N3 occurrences of 1011101 next to 4 light modules, in the ways implementations read the rule:
 * `inside` 10111010000 and 00001011101 inside the symbol, `edge` the same with the area beyond the edge as light,
 * `once` 1011101 counted once when either side has 4 light modules (edge as light), `runs` a 1:1:3:1:1 run-length core with a 4-wide light run.
 */
export type N3Reading = "inside" | "edge" | "once" | "runs";

export function n3Count(line: readonly boolean[], reading: N3Reading): number {
  const size = line.length;
  if (reading === "inside" || reading === "edge") {
    const padded = reading === "edge" ? [...LIGHT4, ...line, ...LIGHT4] : [...line];
    let count = 0;
    for (let i = 0; i + 11 <= padded.length; i += 1) {
      if (sameAs(padded, i, [...FINDER, ...LIGHT4])) count += 1;
      if (sameAs(padded, i, [...LIGHT4, ...FINDER])) count += 1;
    }
    return count;
  }
  if (reading === "once") {
    const padded = [...LIGHT4, ...line, ...LIGHT4];
    let count = 0;
    for (let i = 4; i + 7 <= size + 4; i += 1) {
      if (sameAs(padded, i, FINDER) && (sameAs(padded, i - 4, LIGHT4) || sameAs(padded, i + 7, LIGHT4))) count += 1;
    }
    return count;
  }
  const history = [0, 0, 0, 0, 0, 0, 0];
  const add = (length: number) => {
    const first = history[0] === 0;
    history.pop();
    history.unshift(first ? length + size : length);
  };
  const patterns = () => {
    const n = history[1]!;
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) + (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0);
  };
  let count = 0;
  let color = false;
  let run = 0;
  for (const v of line) {
    if (v === color) run += 1;
    else {
      add(run);
      if (!color) count += patterns();
      color = v;
      run = 1;
    }
  }
  if (color) {
    add(run);
    run = 0;
  }
  add(run + size);
  return count + patterns();
}

export const penaltyN3 = (m: Matrix, reading: N3Reading) => lines(m).reduce((sum, line) => sum + 40 * n3Count(line, reading), 0);

/**
 * The matrix as it would be with mask `to` instead of `from`: data modules re-masked; format bits rewritten for `to`,
 * or, with `blank`, format and version areas and the dark module left light (the matrix some encoders score before writing them).
 */
export function remask(m: Matrix, version: number, from: number, to: number, blank: boolean): boolean[][] {
  const fn = functionModules(version);
  const out = m.map((row, r) => row.map((v, c) => (fn[r]![c] ? v : v !== maskBit(from, r, c) !== maskBit(to, r, c))));
  const size = m.length;
  const { first, second } = formatPositions(size);
  const word = FORMAT_M[to]!;
  for (const positions of [first, second]) {
    positions.forEach(([r, c], i) => {
      out[r]![c] = blank ? false : ((word >>> i) & 1) === 1;
    });
  }
  if (blank) out[size - 8]![8] = false;
  if (blank && version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      out[Math.floor(i / 3)]![size - 11 + (i % 3)] = false;
      out[size - 11 + (i % 3)]![Math.floor(i / 3)] = false;
    }
  }
  return out;
}

/** For each way to read the rules, the mask 0..7 with the lowest total penalty (ties to the lowest number). */
export function bestMasks(m: Matrix): { reading: string; best: number; scores: number[] }[] {
  const version = (m.length - 17) / 4;
  const chosen = maskOf(m);
  const results: { reading: string; best: number; scores: number[] }[] = [];
  for (const blank of [false, true]) {
    const candidates = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => remask(m, version, chosen, k, blank));
    const base = candidates.map(penaltyN1N2N4);
    for (const reading of ["inside", "edge", "once", "runs"] as const) {
      const scores = candidates.map((c, k) => base[k]! + penaltyN3(c, reading));
      results.push({ reading: `${reading}${blank ? ", format blank" : ""}`, best: scores.indexOf(Math.min(...scores)), scores });
    }
  }
  return results;
}

// ---- fixtures ----

export const BY_VERSION = CAPACITY.map((capacity, i) => ({ version: i + 1, text: sample(capacity, i + 1) }));
export const SHARE_URL = `https://labshelf.org/share/#${sample(92, 42, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")}`;
export const UTF8_TEXT = "Ação, café e 数学: ∑ x² — 🎓 ok";
