/** Pins the base64url codec: unpadded URL-safe output and refusal of non-canonical input. */
import { base64UrlToBytes, bytesToBase64Url } from "../../src/encoding/index";

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
