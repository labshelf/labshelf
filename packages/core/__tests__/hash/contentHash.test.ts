import { sha256Hex } from "../../src/hash/index";

describe("contentHash", () => {
  it("produces a stable SHA-256 hex digest", async () => {
    expect(await sha256Hex(new Uint8Array(Buffer.from("abc", "utf8")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
