/** Verifies the path and project-id rules every helper message applies before touching the helper's data folder, and the socket framing: length-prefixed JSON envelope followed by raw payload bytes. */
import { checkHelperPath, decodeConnectionMessage, encodeConnectionMessage, isHelperProjectId } from "../../src/helper/index";

describe("checkHelperPath", () => {
  it.each(["main.tex", "chapters/intro.tex", "figures/a b/plot.pdf", ".latexmkrc", "a..b/c.tex"])("accepts %s", (path) => {
    expect(checkHelperPath(path)).toBeUndefined();
  });

  it.each([
    ["empty", ""],
    ["a parent segment", "../main.tex"],
    ["a nested parent segment", "chapters/../../main.tex"],
    ["a leading slash", "/etc/passwd"],
    ["a backslash", "chapters\\intro.tex"],
    ["a NUL", "main\u0000.tex"],
    ["a drive letter", "C:/main.tex"],
    ["a bare drive letter", "c:main.tex"],
    ["an empty segment", "chapters//intro.tex"],
    ["a trailing slash", "chapters/"],
    ["a dot segment", "./main.tex"],
  ])("rejects %s", (_name, path) => {
    expect(checkHelperPath(path)).toEqual(expect.any(String));
  });

  it("accepts 260 characters and rejects 261", () => {
    expect(checkHelperPath("a".repeat(260))).toBeUndefined();
    expect(checkHelperPath("a".repeat(261))).toEqual(expect.any(String));
  });
});

describe("isHelperProjectId", () => {
  it.each(["thesis", "deep-nets-a-survey", "paper2"])("accepts %s", (id) => {
    expect(isHelperProjectId(id)).toBe(true);
  });

  it.each(["", ".", "..", "a/b", "a\\b", "a\u0000b", " thesis", "-x", "x-", "a--b", "Thesis", "a_b"])("rejects %j", (id) => {
    expect(isHelperProjectId(id)).toBe(false);
  });
});

const envelope = { v: 2, id: "7", type: "compile", projectId: "thesis" };

describe("socket frame", () => {
  it("lays out a 4-byte little-endian JSON length, the JSON, then the payload", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const bytes = encodeConnectionMessage(envelope, payload);
    const json = new TextEncoder().encode(JSON.stringify(envelope));
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)).toBe(json.length);
    expect(Array.from(bytes.subarray(4 + json.length))).toEqual([1, 2, 3]);
  });

  it("round-trips an envelope with and without a payload", () => {
    const withPayload = decodeConnectionMessage(encodeConnectionMessage(envelope, new Uint8Array([9, 8])));
    expect(withPayload.envelope).toEqual(envelope);
    expect(Array.from(withPayload.payload)).toEqual([9, 8]);
    const bare = decodeConnectionMessage(encodeConnectionMessage(envelope));
    expect(bare.envelope).toEqual(envelope);
    expect(bare.payload.length).toBe(0);
  });

  it("keeps non-ASCII text in the envelope", () => {
    expect(decodeConnectionMessage(encodeConnectionMessage({ ...envelope, text: "é漢" })).envelope).toEqual({ ...envelope, text: "é漢" });
  });

  it("rejects a message shorter than its length prefix", () => {
    expect(() => decodeConnectionMessage(new Uint8Array([1, 0]))).toThrow();
    const bytes = encodeConnectionMessage(envelope);
    expect(() => decodeConnectionMessage(bytes.subarray(0, bytes.length - 2))).toThrow();
  });

  it("rejects an envelope that is not JSON", () => {
    const bytes = new Uint8Array([3, 0, 0, 0, 0x7b, 0x6e, 0x6f]);
    expect(() => decodeConnectionMessage(bytes)).toThrow();
  });

  it("rejects a message over 16 MiB on decode and on encode", () => {
    const big = new Uint8Array(16 * 1024 * 1024 + 1);
    expect(() => encodeConnectionMessage(envelope, big)).toThrow();
    const raw = new Uint8Array(big.length);
    new DataView(raw.buffer).setUint32(0, 2, true);
    expect(() => decodeConnectionMessage(raw)).toThrow();
  });
});
