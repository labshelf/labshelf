/** Pins that a share session refuses foreign frames and delivers extension channel messages over the mesh. */
import * as Y from "yjs";
import { deriveContentKey, sealFrame } from "../../../src/collab/crypto/index";
import { indexFiles } from "../../../src/collab/model/index";
import {
  createShareSession, deriveDocId, INDEX_DOC_KEY, encodeEnvelope, MESSAGE_KIND, type ShareSession,
} from "../../../src/collab/sync/index";
import type { PeerTransport } from "../../../src/collab/transport/index";
import type { ILogger } from "../../../src/ports/index";
import { FakeClock, FakeNetwork, runUntil } from "./fakeNetwork";

const SHARE_ID = "f".repeat(32);
const keyOf = (fill: number) => deriveContentKey(new Uint8Array(16).fill(fill));
const fakeLogger = () => ({
  log: jest.fn(async (..._args: Parameters<ILogger["log"]>) => {}),
  error: jest.fn(async (..._args: Parameters<ILogger["error"]>) => {}),
});
type FakeLogger = ReturnType<typeof fakeLogger>;

interface Client { id: string; session: ShareSession; logger: FakeLogger; transport: PeerTransport }

async function client(net: FakeNetwork, clock: FakeClock, id: string, keyFill = 1): Promise<Client> {
  const logger = fakeLogger();
  const transport = net.join(id);
  const session = createShareSession({
    shareId: SHARE_ID, contentKey: await keyOf(keyFill), transport, logger, scheduler: clock, backgroundIntervalMs: 100,
  });
  return { id, session, logger, transport };
}

const text = (doc: Y.Doc) => doc.getText("content");

const warningsAbout = (logger: FakeLogger, peer: string) =>
  logger.log.mock.calls.filter(([level, , , context]) => level === "WARN" && context?.peer === peer);

describe("share session", () => {
  let clock: FakeClock;
  let net: FakeNetwork;
  let clients: Client[] = [];
  beforeEach(() => { clock = new FakeClock(); net = new FakeNetwork(clock); });
  afterEach(async () => { await Promise.all(clients.map((c) => c.session.close())); clients = []; });

  it("applies nothing from a peer with the wrong key and logs it once", async () => {
    clients = [await client(net, clock, "a"), await client(net, clock, "b"), await client(net, clock, "x", 9)];
    const [a, b, x] = clients as [Client, Client, Client];
    indexFiles(x.session.index).set("evil.typ", { kind: "text" });
    text(x.session.openDoc("main.typ")).insert(0, "evil");
    text(a.session.openDoc("main.typ")).insert(0, "good");
    expect(await runUntil(clock, () => text(b.session.openDoc("main.typ")).toString() === "good")).toBe(true);
    text(x.session.openDoc("main.typ")).insert(0, "more evil");
    clock.advance(10_000);
    expect(await runUntil(clock, () => false, 5_000)).toBe(false);
    for (const c of [a, b]) {
      expect(indexFiles(c.session.index).size).toBe(0);
      expect(text(c.session.openDoc("main.typ")).toString()).toBe("good");
      expect(warningsAbout(c.logger, "x")).toHaveLength(1);
    }
  });

  it("drops an authentic frame whose doc key does not hash to its doc id", async () => {
    clients = [await client(net, clock, "a")];
    const raw = net.join("raw");
    const source = new Y.Doc();
    indexFiles(source).set("planted.typ", { kind: "text" });
    const update = Y.encodeStateAsUpdate(source);
    const send = async (docKey: string, headerKey: string) => {
      const docId = await deriveDocId(SHARE_ID, headerKey);
      const key = new TextEncoder().encode(docKey);
      const plaintext = new Uint8Array([key.length >> 8, key.length & 0xff, ...key, ...update]);
      const docIdHex = Buffer.from(docId).toString("hex");
      const frame = await sealFrame(await keyOf(1), { shareId: SHARE_ID, docKey: docIdHex, kind: "syncStep2" }, plaintext);
      raw.send("a", encodeEnvelope({ kind: MESSAGE_KIND.syncStep2, epoch: 1n, seq: 1, docId, frame }));
    };
    await send("main.typ", INDEX_DOC_KEY);
    await runUntil(clock, () => false, 1_000);
    expect(indexFiles(clients[0]!.session.index).size).toBe(0);
    expect(warningsAbout(clients[0]!.logger, "raw")).toHaveLength(1);
    await send(INDEX_DOC_KEY, INDEX_DOC_KEY);
    expect(await runUntil(clock, () => indexFiles(clients[0]!.session.index).has("planted.typ"), 1_000)).toBe(true);
  });

  it("delivers a message of an extension channel with its doc key", async () => {
    clients = [await client(net, clock, "a"), await client(net, clock, "b")];
    const received: [string, string, number[]][] = [];
    const key = await keyOf(2);
    clients[1]!.session.channel({ kind: 16, name: "probe", key, reliable: true, onMessage: (from, docKey, payload) => received.push([from, docKey, [...payload]]) });
    const probe = clients[0]!.session.channel({ kind: 16, name: "probe", key, reliable: true, onMessage: () => {} });
    await probe.send("all", "hash", new Uint8Array([1, 2]));
    expect(await runUntil(clock, () => received.length > 0)).toBe(true);
    expect(received).toEqual([["a", "hash", [1, 2]]]);
    expect(() => clients[0]!.session.channel({ kind: MESSAGE_KIND.ack, name: "x", key, reliable: true, onMessage: () => {} })).toThrow();
  });
});
