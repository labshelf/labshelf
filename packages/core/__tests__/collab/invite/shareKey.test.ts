/** Pins share key generation, deterministic share ids, the relay token and rotation. */
import {
  deriveRelayToken,
  deriveShareId,
  createShareKey,
  createNextShareKey,
} from "../../../src/collab/invite/index";

describe("share key", () => {
  it("generates 16 random bytes", () => {
    const a = createShareKey();
    expect(a).toHaveLength(16);
    expect(createShareKey()).not.toEqual(a);
  });

  it("derives the same 32-char lowercase hex share id from the same key", async () => {
    const key = new Uint8Array(16).fill(7);
    const id = await deriveShareId(key);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await deriveShareId(new Uint8Array(16).fill(7))).toBe(id);
    expect(await deriveShareId(new Uint8Array(16).fill(8))).not.toBe(id);
  });

  it("derives a stable relay token", async () => {
    const key = new Uint8Array(16).fill(3);
    const token = await deriveRelayToken(key);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deriveRelayToken(key)).toBe(token);
  });

  it("rotates to a fresh key and share id and returns the replaced one", async () => {
    const shareKey = createShareKey();
    const current = { shareKey, shareId: await deriveShareId(shareKey) };
    const { previous, next } = await createNextShareKey(current);
    expect(previous).toBe(current);
    expect(next.shareKey).not.toEqual(shareKey);
    expect(next.shareId).not.toBe(current.shareId);
    expect(next.shareId).toBe(await deriveShareId(next.shareKey));
  });
});
