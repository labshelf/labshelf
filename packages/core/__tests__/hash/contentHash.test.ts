import { deriveSha256Hex, deriveTextSha256Hex } from "../../src/hash/index";

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("contentHash", () => {
  it("produces a stable SHA-256 hex digest", async () => {
    expect(await deriveSha256Hex(new Uint8Array(Buffer.from("abc", "utf8")))).toBe(ABC);
  });
});

describe("deriveTextSha256Hex", () => {
  it("hashes the known vector for abc", async () => {
    expect(await deriveTextSha256Hex("abc")).toBe(ABC);
  });

  it("gives a string and its UTF-8 bytes the same digest", async () => {
    const text = "héllo wörld";
    expect(await deriveTextSha256Hex(text)).toBe(await deriveTextSha256Hex(new TextEncoder().encode(text)));
  });

  it("hashes the empty string", async () => {
    expect(await deriveTextSha256Hex("")).toBe(EMPTY);
    expect(await deriveTextSha256Hex(new Uint8Array())).toBe(EMPTY);
  });

  it("hashes non-ASCII text as UTF-8", async () => {
    const text = "日本語 ✓";
    expect(await deriveTextSha256Hex(text)).toBe(await deriveSha256Hex(new Uint8Array(Buffer.from(text, "utf8"))));
  });
});
