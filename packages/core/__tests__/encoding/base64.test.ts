/** Pins the base64 codec: lossless round trips and refusal of anything but canonical padded base64. */
import { base64ToBytes, bytesToBase64, isCanonicalBase64 } from "../../src/encoding/index";

describe("base64", () => {
  it("round-trips bytes, including input larger than one conversion slice", () => {
    const bytes = new Uint8Array(0x8000 * 3 + 2).map((_, i) => (i * 13 + (i >> 8)) % 256);
    const text = bytesToBase64(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64"));
    expect(base64ToBytes(text)).toEqual(bytes);
    expect(base64ToBytes("")).toEqual(new Uint8Array());
  });

  it.each([
    ["characters outside the alphabet", "not base64!"],
    ["missing padding", "AA"],
    ["non-zero padding bits", "AB=="],
    ["non-zero bits before a single pad", "AAB="],
    ["whitespace", "AA AA"],
    ["URL-safe alphabet", "-_8="],
  ])("rejects %s", (_name, text) => {
    expect(isCanonicalBase64(text)).toBe(false);
    expect(() => base64ToBytes(text)).toThrow();
  });

  it("accepts canonical padded base64", () => {
    expect(["", "AA==", "AAA=", "AAAA", "+/8="].every(isCanonicalBase64)).toBe(true);
  });
});
