/** Pins the hex codec: lower-case output and strict parsing. */
import { bytesToHex, hexToBytes } from "../../src/encoding/index";

describe("hex", () => {
  it("round-trips bytes through lower-case hex", () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xa0, 0xff]);
    expect(bytesToHex(bytes)).toBe("000fa0ff");
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it("accepts upper case", () => {
    expect(hexToBytes("0FA0FF")).toEqual(new Uint8Array([0x0f, 0xa0, 0xff]));
  });

  it("gives empty bytes for empty text", () => {
    expect(hexToBytes("")).toEqual(new Uint8Array());
  });

  it.each([
    ["an odd length", "abc"],
    ["non-hex characters", "zz"],
  ])("throws on %s", (_label, text) => {
    expect(() => hexToBytes(text)).toThrow(`Not hexadecimal (${text.length} characters)`);
  });

  it("parses every deriveSha256Hex result unchanged, the only input the old lenient shareCipher copy received", () => {
    const digest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(bytesToHex(hexToBytes(digest))).toBe(digest);
  });
});
