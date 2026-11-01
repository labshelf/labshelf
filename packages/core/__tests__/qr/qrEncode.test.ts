// QR encoder: structure and round-trip checks against ISO/IEC 18004 (byte mode, level M, versions 1-10) with a small decoder kept in this file.
import { encodeQr, qrVersionFor } from "../../src/qr/qrEncode";

type Matrix = readonly (readonly boolean[])[];

const TOO_LONG = "Text is too long for a QR code (213 bytes at most).";

/** Byte-mode capacity at level M of versions 1..10. */
const CAPACITY = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
/** Total codewords (data + EC) of versions 1..10. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
/** Level M per version 1..10: EC codewords per block and block groups as [block count, data codewords per block]. */
const M_BLOCKS: readonly { ec: number; groups: readonly (readonly [number, number])[] }[] = [
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
const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
/** Version information words (ISO/IEC 18004 Annex D). */
const VERSION_INFO: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
/** Format information words for level M, masks 0..7 (ISO/IEC 18004 Annex C), already XORed with 0x5412. */
const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

const cell = (m: Matrix, r: number, c: number): boolean => m[r]![c]!;
const sizeOf = (version: number) => 17 + 4 * version;
const utf8 = (text: string): number[] => Array.from(Buffer.from(text, "utf8"));

/** Deterministic printable text of `length` characters from `alphabet`. */
function sample(length: number, seed: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -_.~!$&'()*+,;=:@/?"): string {
  let state = seed * 7919 + 17;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[Math.floor((state / 2147483648) * alphabet.length)];
  }
  return out;
}

// ---- BCH words ----

function formatWord(mask: number): number {
  const data = (0b00 << 3) | mask; // level M is 00
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) & 1 ? 0x537 : 0);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function versionWord(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) & 1 ? 0x1f25 : 0);
  return (version << 12) | (rem & 0xfff);
}

// ---- layout ----

/** [row, column] of format bit i (bit 0 = least significant) in the first and second copy. */
function formatPositions(size: number): { first: [number, number][]; second: [number, number][] } {
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

const readWord = (m: Matrix, positions: [number, number][]) => positions.reduce((word, [r, c], i) => word | ((cell(m, r, c) ? 1 : 0) << i), 0);

function alignmentCenters(version: number): [number, number][] {
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
function functionModules(version: number): boolean[][] {
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

function maskBit(mask: number, r: number, c: number): boolean {
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
function maskOf(m: Matrix): number {
  return FORMAT_M.indexOf(readWord(m, formatPositions(m.length).first));
}

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----

const EXP = new Array<number>(512).fill(0);
const LOG = new Array<number>(256).fill(0);
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
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** EC codewords of `data`: remainder of data(x)·x^n by the generator with roots α^0..α^(n-1). */
function reedSolomon(data: readonly number[], n: number): number[] {
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

function readCodewords(m: Matrix, version: number, mask: number): number[] {
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

function deinterleave(codewords: readonly number[], version: number): { data: number[]; ec: number[] }[] {
  const { ec, groups } = M_BLOCKS[version - 1]!;
  const lengths = groups.flatMap(([count, data]) => new Array<number>(count).fill(data));
  const blocks = lengths.map(() => ({ data: [] as number[], ec: [] as number[] }));
  let k = 0;
  for (let i = 0; i < Math.max(...lengths); i += 1) lengths.forEach((len, b) => i < len && blocks[b]!.data.push(codewords[k++]!));
  for (let i = 0; i < ec; i += 1) blocks.forEach((block) => block.ec.push(codewords[k++]!));
  if (k !== codewords.length) throw new Error(`decoder: block table uses ${k} of ${codewords.length} codewords`);
  return blocks;
}

function parseByteMode(data: readonly number[], version: number): number[] {
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
function decode(m: Matrix): { version: number; mask: number; bytes: number[] } {
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

function lines(m: Matrix): boolean[][] {
  const size = m.length;
  const rows = m.map((row) => [...row]);
  const columns = Array.from({ length: size }, (_, c) => Array.from({ length: size }, (_, r) => cell(m, r, c)));
  return [...rows, ...columns];
}

function penaltyN1N2N4(m: Matrix): number {
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

const FINDER = [true, false, true, true, true, false, true];
const LIGHT4 = [false, false, false, false];
const sameAs = (line: readonly boolean[], at: number, pattern: readonly boolean[]) => pattern.every((v, k) => line[at + k] === v);

/**
 * N3 occurrences of 1011101 next to 4 light modules, in the ways implementations read the rule:
 * `inside` 10111010000 and 00001011101 inside the symbol, `edge` the same with the area beyond the edge as light,
 * `once` 1011101 counted once when either side has 4 light modules (edge as light), `runs` a 1:1:3:1:1 run-length core with a 4-wide light run.
 */
type N3Reading = "inside" | "edge" | "once" | "runs";

function n3Count(line: readonly boolean[], reading: N3Reading): number {
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

const penaltyN3 = (m: Matrix, reading: N3Reading) => lines(m).reduce((sum, line) => sum + 40 * n3Count(line, reading), 0);

/**
 * The matrix as it would be with mask `to` instead of `from`: data modules re-masked; format bits rewritten for `to`,
 * or, with `blank`, format and version areas and the dark module left light (the matrix some encoders score before writing them).
 */
function remask(m: Matrix, version: number, from: number, to: number, blank: boolean): boolean[][] {
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
function bestMasks(m: Matrix): { reading: string; best: number; scores: number[] }[] {
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

const BY_VERSION = CAPACITY.map((capacity, i) => ({ version: i + 1, text: sample(capacity, i + 1) }));
const SHARE_URL = `https://labshelf.org/share/#${sample(92, 42, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")}`;
const UTF8_TEXT = "Ação, café e 数学: ∑ x² — 🎓 ok";

describe("qrVersionFor and encodeQr version choice", () => {
  it("3.2a qrVersionFor picks the smallest version for 1, 14, 15, 106, 107 and 213 bytes", () => {
    expect([1, 14, 15, 106, 107, 213].map((n) => qrVersionFor(n))).toEqual([1, 1, 2, 6, 7, 10]);
  });

  it("3.2a qrVersionFor switches version exactly past each level-M byte capacity", () => {
    const expected = CAPACITY.flatMap((capacity, i) => (i < 9 ? [[capacity, i + 1], [capacity + 1, i + 2]] : [[capacity, i + 1]]));
    expect(expected.map(([n]) => [n, qrVersionFor(n!)])).toEqual(expected);
  });

  it("3.2a qrVersionFor refuses 214 bytes with a RangeError", () => {
    expect(() => qrVersionFor(214)).toThrow(new RangeError(TOO_LONG));
    expect(() => qrVersionFor(214)).toThrow(RangeError);
  });

  it("3.2a encodeQr returns a 17 + 4v matrix for the smallest version of 1, 14, 15, 106, 107 and 213 bytes", () => {
    const sizes = [1, 14, 15, 106, 107, 213].map((n) => encodeQr("a".repeat(n)).length);
    expect(sizes).toEqual([1, 1, 2, 6, 7, 10].map(sizeOf));
  });

  it("3.2a encodeQr counts UTF-8 bytes, not characters", () => {
    expect(encodeQr("é".repeat(7)).length).toBe(sizeOf(1)); // 14 bytes
    expect(encodeQr("é".repeat(8)).length).toBe(sizeOf(2)); // 16 bytes
  });

  it("3.2a encodeQr refuses text over 213 bytes with a RangeError", () => {
    expect(() => encodeQr("a".repeat(214))).toThrow(new RangeError(TOO_LONG));
    expect(() => encodeQr("é".repeat(107))).toThrow(new RangeError(TOO_LONG)); // 107 characters, 214 bytes
  });
});

describe("encodeQr function patterns", () => {
  it("3.2b returns a square boolean matrix of size 17 + 4v for versions 1 to 10", () => {
    for (const { version, text } of BY_VERSION) {
      const m = encodeQr(text);
      expect(m.length).toBe(sizeOf(version));
      for (const row of m) {
        expect(row.length).toBe(sizeOf(version));
        expect(row.every((v) => typeof v === "boolean")).toBe(true);
      }
    }
  });

  it("3.2b has the three finder patterns with light separators", () => {
    for (const { version, text } of BY_VERSION) {
      const m = encodeQr(text);
      const size = sizeOf(version);
      const wrong: string[] = [];
      for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
        for (let r = 0; r < 7; r += 1) {
          for (let c = 0; c < 7; c += 1) {
            const want = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
            if (cell(m, r0 + r, c0 + c) !== want) wrong.push(`v${version} finder (${r0 + r},${c0 + c})`);
          }
        }
      }
      const separator: [number, number][] = [];
      for (let i = 0; i < 8; i += 1) {
        separator.push([7, i], [i, 7], [7, size - 1 - i], [i, size - 8], [size - 8, i], [size - 1 - i, 7]);
      }
      for (const [r, c] of separator) if (cell(m, r, c)) wrong.push(`v${version} separator (${r},${c})`);
      expect(wrong).toEqual([]);
    }
  });

  it("3.2b has the timing patterns on row 6 and column 6", () => {
    for (const { version, text } of BY_VERSION) {
      const m = encodeQr(text);
      const size = sizeOf(version);
      const wrong: string[] = [];
      for (let i = 8; i <= size - 9; i += 1) {
        if (cell(m, 6, i) !== (i % 2 === 0)) wrong.push(`v${version} row timing (6,${i})`);
        if (cell(m, i, 6) !== (i % 2 === 0)) wrong.push(`v${version} column timing (${i},6)`);
      }
      expect(wrong).toEqual([]);
    }
  });

  it("3.2b has the alignment patterns of versions 2 to 10", () => {
    for (const { version, text } of BY_VERSION) {
      const m = encodeQr(text);
      const wrong: string[] = [];
      for (const [cr, cc] of alignmentCenters(version)) {
        for (let dr = -2; dr <= 2; dr += 1) {
          for (let dc = -2; dc <= 2; dc += 1) {
            const want = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            if (cell(m, cr + dr, cc + dc) !== want) wrong.push(`v${version} alignment at (${cr},${cc}) module (${cr + dr},${cc + dc})`);
          }
        }
      }
      expect(wrong).toEqual([]);
      expect(alignmentCenters(version).length).toBe(version === 1 ? 0 : version < 7 ? 1 : 6);
    }
  });

  it("3.2b has the dark module at row 4v + 9, column 8", () => {
    for (const { version, text } of BY_VERSION) {
      expect([version, cell(encodeQr(text), 4 * version + 9, 8)]).toEqual([version, true]);
    }
  });

  it("3.2b carries level-M format bits (BCH, XOR 0x5412) for its mask in both copies", () => {
    // The literal table agrees with the BCH computation.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(formatWord)).toEqual(FORMAT_M);
    for (const { version, text } of [...BY_VERSION, { version: 7, text: SHARE_URL }]) {
      const m = encodeQr(text);
      const { first, second } = formatPositions(m.length);
      const word = readWord(m, first);
      const mask = FORMAT_M.indexOf(word);
      expect({ version, levelM: mask >= 0 }).toEqual({ version, levelM: true });
      expect({ version, second: readWord(m, second) }).toEqual({ version, second: word });
    }
  });

  it("3.2b carries version bits in both blocks for versions 7 to 10", () => {
    expect([7, 8, 9, 10].map(versionWord)).toEqual([7, 8, 9, 10].map((v) => VERSION_INFO[v]));
    for (const { version, text } of BY_VERSION.filter((entry) => entry.version >= 7)) {
      const m = encodeQr(text);
      const size = m.length;
      const topRight: [number, number][] = [];
      const bottomLeft: [number, number][] = [];
      for (let i = 0; i < 18; i += 1) {
        topRight.push([Math.floor(i / 3), size - 11 + (i % 3)]);
        bottomLeft.push([size - 11 + (i % 3), Math.floor(i / 3)]);
      }
      expect({ version, topRight: readWord(m, topRight), bottomLeft: readWord(m, bottomLeft) }).toEqual({
        version,
        topRight: VERSION_INFO[version],
        bottomLeft: VERSION_INFO[version],
      });
    }
  });
});

describe("encodeQr data round trip", () => {
  it("3.2c decodes back to the bytes of an ASCII text", () => {
    const text = "Hello, labshelf!";
    const { version, bytes } = decode(encodeQr(text));
    expect(version).toBe(2);
    expect(bytes).toEqual(utf8(text));
  });

  it("3.2c decodes back to the UTF-8 bytes of a non-ASCII text", () => {
    const { version, bytes } = decode(encodeQr(UTF8_TEXT));
    expect(version).toBe(qrVersionFor(utf8(UTF8_TEXT).length));
    expect(bytes).toEqual(utf8(UTF8_TEXT));
  });

  it("3.2c decodes back to a 120-character share URL at version 7", () => {
    expect(SHARE_URL).toHaveLength(120);
    const { version, bytes } = decode(encodeQr(SHARE_URL));
    expect(version).toBe(7);
    expect(bytes).toEqual(utf8(SHARE_URL));
  });

  it("3.2c decodes back to the input at the full capacity of every version 1 to 10", () => {
    for (const { version, text } of BY_VERSION) {
      const decoded = decode(encodeQr(text));
      expect({ version: decoded.version, bytes: decoded.bytes }).toEqual({ version, bytes: utf8(text) });
    }
  });

  it("3.2c decodes back to short inputs that need terminator and pad codewords", () => {
    for (const text of ["a", "0123456789", sample(60, 7), sample(150, 8)]) {
      expect(decode(encodeQr(text)).bytes).toEqual(utf8(text));
    }
  });
});

describe("encodeQr mask choice", () => {
  it("3.2d picks the mask with the lowest N1-N4 penalty of the eight, ties to the lowest number", () => {
    const texts = [...BY_VERSION.map((entry) => entry.text), SHARE_URL, UTF8_TEXT, "a", "https://labshelf.org/"];
    for (const text of texts) {
      const m = encodeQr(text);
      const chosen = maskOf(m);
      expect(chosen).toBeGreaterThanOrEqual(0);
      // N3 and the state of the format area while scoring are read several ways by implementations of the standard;
      // the chosen mask must be the minimum (lowest number on ties) under one of those readings.
      const readings = bestMasks(m);
      const minimal = readings.some((reading) => reading.best === chosen);
      expect({ text, chosen, minimal, readings: minimal ? [] : readings }).toEqual({ text, chosen, minimal: true, readings: [] });
    }
  });

  it("3.2d gives the same matrix for the same text, as a fresh array each call", () => {
    const first = encodeQr(SHARE_URL);
    const second = encodeQr(SHARE_URL);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    const snapshot = first.map((row) => [...row]);
    first[0]![0] = !first[0]![0];
    expect(encodeQr(SHARE_URL)).toEqual(snapshot);
  });
});
