/** Pins what a share's Durable Object stores, replays, compacts and forwards over its sockets, and (A7) that what it stores
 * holds no plaintext of the sealed frames it received. */
import { deriveContentShareKey, createShareKey, sealFrame } from "../../../src/collab/invite/index";
import { RELAY_ERROR_CODE } from "../../../src/relay/index";
import { FakeRoom } from "./fakeRoomRuntime";

const docA = "aa".repeat(16);
const docB = "bb".repeat(16);
const bytes = (...values: number[]) => new Uint8Array(values);

describe("relay room", () => {
  it("introduces peers with ids that are never reused", () => {
    const room = new FakeRoom();
    const first = room.connect();
    expect(first.take()).toEqual([{ type: "peers", ids: [] }]);
    const second = room.connect();
    expect(second.take()).toEqual([{ type: "peers", ids: [1] }]);
    expect(first.take()).toEqual([{ type: "joined", id: 2 }]);
    room.close(second);
    expect(first.take()).toEqual([{ type: "left", id: 2 }]);
    room.connect();
    expect(first.take()).toEqual([{ type: "joined", id: 3 }]);
  });

  it("stores puts under share-wide cursors and replays a doc since a cursor", () => {
    const room = new FakeRoom();
    const writer = room.connect();
    const other = room.connect();
    writer.take(); other.take();
    expect(room.send(writer, { type: "put", doc: docA, frame: bytes(1) })).toEqual([{ type: "accepted", doc: docA, cursor: 1 }]);
    expect(other.take()).toEqual([{ type: "stored", from: 1, doc: docA, cursor: 1, frame: bytes(1) }]);
    room.send(writer, { type: "put", doc: docB, frame: bytes(2) });
    room.send(writer, { type: "put", doc: docA, frame: bytes(3) });
    other.take();
    expect(room.send(other, { type: "since", doc: docA, cursor: 0 })).toEqual([
      { type: "rows", doc: docA, more: false, items: [{ cursor: 1, frame: bytes(1) }, { cursor: 3, frame: bytes(3) }] },
    ]);
    expect(room.send(other, { type: "since", doc: docA, cursor: 1 })).toEqual([
      { type: "rows", doc: docA, more: false, items: [{ cursor: 3, frame: bytes(3) }] },
    ]);
  });

  it("pages a replay under the message cap", () => {
    const room = new FakeRoom();
    const socket = room.connect();
    socket.take();
    const big = new Uint8Array(400 * 1024).fill(9);
    for (let index = 0; index < 3; index += 1) { room.send(socket, { type: "put", doc: docA, frame: big }); }
    const [page] = room.send(socket, { type: "since", doc: docA, cursor: 0 });
    expect(page).toMatchObject({ type: "rows", more: true });
    expect((page as { items: { cursor: number }[] }).items.map((item) => item.cursor)).toEqual([1, 2]);
    const [rest] = room.send(socket, { type: "since", doc: docA, cursor: 2 });
    expect(rest).toMatchObject({ type: "rows", more: false, items: [{ cursor: 3 }] });
  });

  it("deletes the rows a snapshot covers, replays the snapshot first and refuses a stale one", () => {
    const room = new FakeRoom();
    const socket = room.connect();
    socket.take();
    room.send(socket, { type: "put", doc: docA, frame: bytes(1) });
    room.send(socket, { type: "put", doc: docB, frame: bytes(2) });
    room.send(socket, { type: "put", doc: docA, frame: bytes(3) });
    room.send(socket, { type: "put", doc: docA, frame: bytes(4) });
    expect(room.send(socket, { type: "snapshot", doc: docA, covers: 3, frame: bytes(5) })).toEqual([{ type: "accepted", doc: docA, cursor: 3 }]);
    const cursors = (room.db.prepare("SELECT cursor FROM updates ORDER BY cursor").all() as { cursor: number }[]).map((row) => row.cursor);
    expect(cursors).toEqual([2, 4]);
    expect(room.send(socket, { type: "since", doc: docA, cursor: 0 })).toEqual([
      { type: "rows", doc: docA, more: false, snapshot: { covers: 3, frame: bytes(5) }, items: [{ cursor: 4, frame: bytes(4) }] },
    ]);
    expect(room.send(socket, { type: "since", doc: docA, cursor: 3 })).toEqual([
      { type: "rows", doc: docA, more: false, items: [{ cursor: 4, frame: bytes(4) }] },
    ]);
    const stale = { type: "error", code: RELAY_ERROR_CODE.staleSnapshot, doc: docA };
    expect(room.send(socket, { type: "snapshot", doc: docA, covers: 3, frame: bytes(6) })).toEqual([stale]);
    expect(room.send(socket, { type: "snapshot", doc: docA, covers: 5, frame: bytes(6) })).toEqual([stale]);
  });

  it("keeps cursors rising after a snapshot deletes the latest row", () => {
    const room = new FakeRoom();
    const socket = room.connect();
    socket.take();
    room.send(socket, { type: "put", doc: docA, frame: bytes(1) });
    room.send(socket, { type: "snapshot", doc: docA, covers: 1, frame: bytes(2) });
    expect(room.send(socket, { type: "put", doc: docA, frame: bytes(3) })).toEqual([{ type: "accepted", doc: docA, cursor: 2 }]);
  });

  it("forwards to the target peer only, or to every other peer, and stores nothing", () => {
    const room = new FakeRoom();
    const [one, two, three] = [room.connect(), room.connect(), room.connect()];
    [one, two, three].forEach((socket) => socket.take());
    expect(room.send(one, { type: "forward", to: 3, frame: bytes(7) })).toEqual([]);
    expect(two.take()).toEqual([]);
    expect(three.take()).toEqual([{ type: "forwarded", from: 1, frame: bytes(7) }]);
    room.send(one, { type: "forward", to: 0, frame: bytes(8) });
    expect([two.take(), three.take()]).toEqual([[{ type: "forwarded", from: 1, frame: bytes(8) }], [{ type: "forwarded", from: 1, frame: bytes(8) }]]);
    room.send(one, { type: "forward", to: 99, frame: bytes(9) });
    expect(room.db.prepare("SELECT COUNT(*) AS n FROM updates").get()).toEqual(expect.objectContaining({ n: 0 }));
  });

  it("answers malformed and oversized messages and ignores text", () => {
    const room = new FakeRoom();
    const socket = room.connect();
    socket.take();
    room.room.webSocketMessage(socket, Uint8Array.of(2, 0, 1, 0xaa).buffer);
    expect(socket.take()).toEqual([{ type: "error", code: RELAY_ERROR_CODE.malformed }]);
    room.room.webSocketMessage(socket, Uint8Array.of(3, 0, 1).buffer);
    expect(socket.take()).toEqual([{ type: "error", code: RELAY_ERROR_CODE.incompatibleVersion }]);
    room.room.webSocketMessage(socket, "hello");
    expect(socket.take()).toEqual([]);
    const tooBig = new Uint8Array(1024 * 1024 - 23).fill(1);
    expect(room.send(socket, { type: "put", doc: docA, frame: tooBig })).toEqual([{ type: "error", code: RELAY_ERROR_CODE.tooLarge, doc: docA }]);
  });
});

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
