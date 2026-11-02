// QR encoder: structure and round-trip checks against ISO/IEC 18004 (byte mode, level M, versions 1-10) with a small decoder kept in qrEncodeHarness.ts.
import { encodeQr, qrVersionFor } from "../../src/qr/qrEncode";
import { TOO_LONG, CAPACITY, VERSION_INFO, FORMAT_M, UTF8_TEXT, utf8, sample, maskOf, decode, bestMasks, cell, sizeOf, formatWord, versionWord, formatPositions, readWord, alignmentCenters, BY_VERSION, SHARE_URL } from "./qrEncodeHarness";

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
