/** Pins authenticated frames: round trip, and refusal of tampering, wrong keys, foreign contexts and bad headers. */
import { deriveAwarenessKey, deriveContentKey, openFrame, sealFrame } from "../../../src/collab/shareKey/index";
import type { FrameContext } from "../../../src/collab/shareKey/index";

const shareKey = new Uint8Array(16).fill(1);
const context: FrameContext = { shareId: "a".repeat(32), docKey: "main.typ", kind: "update" };
const plaintext = new TextEncoder().encode("hello share");

describe("frame", () => {
  it("opens what it seals", async () => {
    const key = await deriveContentKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    expect(frame[0]).toBe(1);
    expect(frame.length).toBe(1 + 12 + plaintext.length + 16);
    expect(await openFrame(key, context, frame)).toEqual({ ok: true, bytes: plaintext });
  });

  it("uses a fresh nonce per frame", async () => {
    const key = await deriveContentKey(shareKey);
    const a = await sealFrame(key, context, plaintext);
    const b = await sealFrame(key, context, plaintext);
    expect(a).not.toEqual(b);
  });

  it("fails authentication on a tampered frame", async () => {
    const key = await deriveContentKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    frame[frame.length - 1] = frame.at(-1)! ^ 1;
    expect(await openFrame(key, context, frame)).toEqual({ ok: false, error: "authFailed" });
  });

  it("fails authentication under a different key", async () => {
    const frame = await sealFrame(await deriveContentKey(shareKey), context, plaintext);
    const other = await deriveContentKey(new Uint8Array(16).fill(2));
    expect(await openFrame(other, context, frame)).toEqual({ ok: false, error: "authFailed" });
    expect(await openFrame(await deriveAwarenessKey(shareKey), context, frame)).toEqual({ ok: false, error: "authFailed" });
  });

  it.each([
    ["docKey", { ...context, docKey: "other.typ" }],
    ["kind", { ...context, kind: "snapshot" }],
    ["shareId", { ...context, shareId: "b".repeat(32) }],
    ["field boundary", { ...context, docKey: "main.typupdate", kind: "" }],
  ])("fails authentication when the %s differs", async (_label, foreign) => {
    const key = await deriveContentKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    expect(await openFrame(key, foreign, frame)).toEqual({ ok: false, error: "authFailed" });
  });

  it("rejects an unknown version byte and a short frame", async () => {
    const key = await deriveContentKey(shareKey);
    const frame = await sealFrame(key, context, plaintext);
    frame[0] = 2;
    expect(await openFrame(key, context, frame)).toEqual({ ok: false, error: "badVersion" });
    expect(await openFrame(key, context, new Uint8Array())).toEqual({ ok: false, error: "tooShort" });
    expect(await openFrame(key, context, new Uint8Array([1, 0, 0]))).toEqual({ ok: false, error: "tooShort" });
  });
});
