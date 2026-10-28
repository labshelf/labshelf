/** Pins the byte-value helpers: comparison, joining and random hex. */
import { joinBytes, randomHex, sameBytes } from "../../src/encoding/index";

describe("sameBytes", () => {
  it("is true for equal bytes and for two empty arrays", () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(sameBytes(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it("is false when the lengths differ", () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("is false when one byte differs", () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]))).toBe(false);
  });
});

describe("joinBytes", () => {
  it("joins chunks in order", () => {
    expect(joinBytes([new Uint8Array([1]), new Uint8Array(), new Uint8Array([2, 3])])).toEqual(new Uint8Array([1, 2, 3]));
    expect(joinBytes([])).toEqual(new Uint8Array());
  });
});

describe("randomHex", () => {
  it("gives two lower-case hex characters per byte, four bytes by default", () => {
    expect(randomHex()).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex(3)).toMatch(/^[0-9a-f]{6}$/);
  });

  it("takes its bytes from the injected fill", () => {
    const fill = (bytes: Uint8Array<ArrayBuffer>) => { bytes.set([0xab, 0x01, 0xff].slice(0, bytes.length)); return bytes; };
    expect(randomHex(3, fill)).toBe("ab01ff");
  });
});
