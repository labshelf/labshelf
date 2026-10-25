/** Pins A7: what a share's Durable Object stores holds no plaintext of the sealed frames it received. */
import { deriveContentShareKey, createShareKey, sealFrame } from "../../../src/collab/shareKey/index";
import { FakeRoom } from "./fakeRoomRuntime";

const doc = "cd".repeat(16);
const plaintextText = "Attention is all you need: a confidential draft paragraph.";
const plaintext = new TextEncoder().encode(plaintextText);

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) { if (haystack[start + index] !== needle[index]) { continue outer; } }
    return true;
  }
  return false;
}

/** True when any stored value holds the plaintext as bytes or as text. */
function leaks(values: unknown[]): boolean {
  return values.some((value) => (value instanceof Uint8Array
    ? contains(value, plaintext) || new TextDecoder("latin1").decode(value).includes(plaintextText)
    : String(value).includes(plaintextText)));
}

async function storeFrames(room: FakeRoom, frame: Uint8Array): Promise<void> {
  const socket = room.connect();
  room.send(socket, { type: "put", doc, frame });
  room.send(socket, { type: "put", doc, frame });
  room.send(socket, { type: "snapshot", doc, covers: 1, frame });
}

describe("relay storage", () => {
  it("keeps sealed frames and no byte or text of their plaintext", async () => {
    const key = await deriveContentShareKey(createShareKey());
    const sealed = await sealFrame(key, { shareId: "ab".repeat(16), docKey: doc, kind: "update" }, plaintext);
    const room = new FakeRoom();
    await storeFrames(room, sealed);
    const values = room.dump();
    expect(values.some((value) => value instanceof Uint8Array && contains(value, sealed))).toBe(true);
    expect(leaks(values)).toBe(false);
  });

  it("detects plaintext when a frame is not sealed, so the check above can fail", async () => {
    const room = new FakeRoom();
    await storeFrames(room, plaintext);
    expect(leaks(room.dump())).toBe(true);
  });
});
