/** Pins the base64url codec: unpadded URL-safe output and refusal of non-canonical input. */
import { base64UrlToBytes, bytesToBase64Url, decodeKeyBytes } from "../../src/encoding/index";

describe("base64url", () => {
  it("round-trips bytes without padding using the URL-safe alphabet", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x01]);
    const text = bytesToBase64Url(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64url"));
    expect(text).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(text)).toEqual(bytes);
    expect(base64UrlToBytes("")).toEqual(new Uint8Array());
  });

  it.each([
    ["padding", "AA=="],
    ["standard alphabet characters", "+/8"],
    ["an impossible length", "A"],
    ["non-zero hidden bits", "AB"],
  ])("rejects %s", (_label, text) => {
    expect(() => base64UrlToBytes(text)).toThrow();
  });
});

describe("decodeKeyBytes", () => {
  const key = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
  const text = bytesToBase64Url(key);

  it("decodes a canonical key of the given length", () => {
    expect(text).toHaveLength(22);
    expect(decodeKeyBytes(text, 16)).toEqual(key);
  });

  it.each([
    ["21 characters", text.slice(0, 21)],
    ["23 characters", `${text}A`],
    ["a plus sign", `+${text.slice(1)}`],
    ["a slash", `/${text.slice(1)}`],
    ["padding", `${text}==`],
    ["stray low bits in the last character", `${text.slice(0, 21)}B`],
    ["inner whitespace", `${text.slice(0, 10)} ${text.slice(11)}`],
    ["a newline", `${text.slice(0, 10)}\n${text.slice(11)}`],
    ["empty text", ""],
  ])("returns undefined, without throwing, for %s", (_label, input) => {
    expect(decodeKeyBytes(input, 16)).toBeUndefined();
  });
});
