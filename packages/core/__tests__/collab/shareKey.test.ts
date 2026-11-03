/** Pins share key generation, deterministic share ids, the relay token and rotation, and authenticated frames (round trip, and refusal of tampering, wrong keys, foreign contexts and bad headers). */
import {
  deriveRelayToken,
  deriveShareId,
  createShareKey,
  createNextShareKey,
  derivePresenceShareKey,
  deriveContentShareKey,
  openFrame,
  sealFrame,
  type FrameContext,
} from "../../src/collab/index";

const shareKey = new Uint8Array(16).fill(1);
const context: FrameContext = { shareId: "a".repeat(32), docKey: "main.typ", kind: "update" };
const plaintext = new TextEncoder().encode("hello share");

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

describe("frame", () => {
  it("opens what it seals", async () => {
    const key = await deriveContentShareKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    expect(frame[0]).toBe(1);
    expect(frame.length).toBe(1 + 12 + plaintext.length + 16);
    expect(await openFrame(key, context, frame)).toEqual({ ok: true, bytes: plaintext });
  });

  it("uses a fresh nonce per frame", async () => {
    const key = await deriveContentShareKey(shareKey);
    const a = await sealFrame(key, context, plaintext);
    const b = await sealFrame(key, context, plaintext);
    expect(a).not.toEqual(b);
  });

  it("fails authentication on a tampered frame", async () => {
    const key = await deriveContentShareKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    frame[frame.length - 1] = frame.at(-1)! ^ 1;
    expect(await openFrame(key, context, frame)).toEqual({ ok: false, error: "authFailed" });
  });

  it("fails authentication under a different key", async () => {
    const frame = await sealFrame(await deriveContentShareKey(shareKey), context, plaintext);
    const other = await deriveContentShareKey(new Uint8Array(16).fill(2));
    expect(await openFrame(other, context, frame)).toEqual({ ok: false, error: "authFailed" });
    expect(await openFrame(await derivePresenceShareKey(shareKey), context, frame)).toEqual({ ok: false, error: "authFailed" });
  });

  it.each([
    ["docKey", { ...context, docKey: "other.typ" }],
    ["kind", { ...context, kind: "snapshot" }],
    ["shareId", { ...context, shareId: "b".repeat(32) }],
    ["field boundary", { ...context, docKey: "main.typupdate", kind: "" }],
  ])("fails authentication when the %s differs", async (_label, foreign) => {
    const key = await deriveContentShareKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    expect(await openFrame(key, foreign, frame)).toEqual({ ok: false, error: "authFailed" });
  });

  it("rejects an unknown version byte and a short frame", async () => {
    const key = await deriveContentShareKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    frame[0] = 2;
    expect(await openFrame(key, context, frame)).toEqual({ ok: false, error: "badVersion" });
    expect(await openFrame(key, context, new Uint8Array())).toEqual({ ok: false, error: "tooShort" });
    expect(await openFrame(key, context, new Uint8Array([1, 0, 0]))).toEqual({ ok: false, error: "tooShort" });
  });
});
