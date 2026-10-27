/** Pins that blobs travel in verified chunks from any peer that holds them and are refused when corrupted or missing. */
import { deriveSha256Hex } from "../../../src/hash/index";
import { attachShareBlobs, type ShareBlobExchange, BLOB_CHUNK_BYTES, ShareBlobFetchError } from "../../../src/collab/doc/index";
import { CHANNEL_KIND } from "../../../src/collab/peer/index";
import { FakeClock, FakeNetwork, runUntil } from "../peer/fakeNetwork";
import { contentKey, openSession, type TestClient } from "./testSession";

const bytesOf = (length: number, seed = 0) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);

describe("blobs", () => {
  let clock: FakeClock;
  let net: FakeNetwork;
  let clients: TestClient[] = [];
  let exchanges: ShareBlobExchange[] = [];
  beforeEach(() => { clock = new FakeClock(); net = new FakeNetwork(clock); });
  afterEach(async () => {
    exchanges.forEach((e) => e.close());
    await Promise.all(clients.map((c) => c.session.close()));
    clients = [];
    exchanges = [];
  });

  async function attach(id: string, getBlob: (hash: string) => Promise<Uint8Array | undefined> = async () => undefined) {
    const client = await openSession(net, clock, id);
    const exchange = attachShareBlobs(client.session, { contentKey: await contentKey(), getBlob, logger: client.logger, scheduler: clock, skipPeer: () => false });
    clients.push(client);
    exchanges.push(exchange);
    return { client, exchange };
  }
  const holding = (bytes: Uint8Array) => async () => bytes;

  /** Settles a fetch while virtual time runs, as the real network would. */
  async function settled(promise: Promise<Uint8Array>): Promise<Uint8Array | ShareBlobFetchError> {
    let result: Uint8Array | ShareBlobFetchError | undefined;
    promise.then((bytes) => { result = bytes; }, (error: unknown) => { result = error as ShareBlobFetchError; });
    expect(await runUntil(clock, () => result !== undefined, 120_000)).toBe(true);
    return result!;
  }

  it("uses kind 17 for blobs and 64 KiB chunks", () => {
    expect(CHANNEL_KIND.blob).toBe(17);
    expect(BLOB_CHUNK_BYTES).toBe(65536);
  });

  it("delivers a blob larger than one chunk intact", async () => {
    const blob = bytesOf(3 * BLOB_CHUNK_BYTES + 123);
    const hash = await deriveSha256Hex(blob);
    const { exchange } = await attach("a");
    await attach("b", holding(blob));
    const sentBefore = net.sent.length;
    expect(await settled(exchange.fetch(hash))).toEqual(blob);
    expect(net.sent.length - sentBefore).toBeGreaterThanOrEqual(5);
  });

  it("delivers an empty blob", async () => {
    const hash = await deriveSha256Hex(new Uint8Array());
    const { exchange } = await attach("a");
    await attach("b", holding(new Uint8Array()));
    expect(await settled(exchange.fetch(hash))).toEqual(new Uint8Array());
  });

  it("shares one request among concurrent fetches of the same hash", async () => {
    const blob = bytesOf(1000);
    const hash = await deriveSha256Hex(blob);
    const { exchange } = await attach("a");
    const getBlob = jest.fn(holding(blob));
    await attach("b", getBlob);
    const [first, second] = await Promise.all([settled(exchange.fetch(hash)), settled(exchange.fetch(hash))]);
    expect(first).toEqual(blob);
    expect(second).toEqual(blob);
    expect(getBlob).toHaveBeenCalledTimes(1);
  });

  it("rejects bytes that do not hash to the request and logs it", async () => {
    const blob = bytesOf(100_000);
    const hash = await deriveSha256Hex(blob);
    const { client, exchange } = await attach("a");
    await attach("b", holding(bytesOf(100_000, 1)));
    const result = await settled(exchange.fetch(hash));
    expect(result).toBeInstanceOf(ShareBlobFetchError);
    expect((result as ShareBlobFetchError).code).toBe("corrupt");
    expect(client.logger.log.mock.calls.some(([level, , , context]) => level === "WARN" && context?.hash === hash)).toBe(true);
  });

  it("asks another peer after a corrupted answer", async () => {
    const blob = bytesOf(70_000);
    const hash = await deriveSha256Hex(blob);
    const { exchange } = await attach("a");
    await attach("b", holding(bytesOf(70_000, 1)));
    await attach("c", holding(blob));
    expect(await settled(exchange.fetch(hash))).toEqual(blob);
  });

  it("fails when no peer holds the blob", async () => {
    const hash = await deriveSha256Hex(bytesOf(10));
    const { exchange } = await attach("a");
    await attach("b");
    const result = await settled(exchange.fetch(hash));
    expect((result as ShareBlobFetchError).code).toBe("unavailable");
  });

  it("fails after a timeout when no peer is connected, and finds a peer that joins before it", async () => {
    const blob = bytesOf(500);
    const hash = await deriveSha256Hex(blob);
    const { exchange } = await attach("a");
    const lonely = await settled(exchange.fetch(hash));
    expect((lonely as ShareBlobFetchError).code).toBe("unavailable");
    const pending = exchange.fetch(hash);
    await attach("b", holding(blob));
    expect(await settled(pending)).toEqual(blob);
  });

  it("asks the next peer when one stays silent", async () => {
    const blob = bytesOf(500);
    const hash = await deriveSha256Hex(blob);
    const { exchange } = await attach("a");
    await attach("b", () => new Promise(() => {}));
    await attach("c", holding(blob));
    expect(await settled(exchange.fetch(hash))).toEqual(blob);
  });

  it("never asks the holder for something that is not a SHA-256 hash", async () => {
    const getBlob = jest.fn(async () => bytesOf(5));
    const { exchange } = await attach("a");
    await attach("b", getBlob);
    const rogue = await openSession(net, clock, "rogue");
    clients.push(rogue);
    const channel = rogue.session.channel({ kind: CHANNEL_KIND.blob, name: "blob", key: await contentKey(), reliable: true, onMessage: () => {} });
    await channel.send("all", "../../etc/passwd", new Uint8Array([1]));
    await expect(exchange.fetch("../../etc/passwd")).rejects.toMatchObject({ code: "invalidHash" });
    await runUntil(clock, () => false, 1000);
    expect(getBlob).not.toHaveBeenCalled();
  });

  it("rejects a pending fetch when the exchange closes", async () => {
    const hash = await deriveSha256Hex(bytesOf(10));
    const { exchange } = await attach("a");
    const pending = exchange.fetch(hash);
    exchange.close();
    await expect(pending).rejects.toMatchObject({ code: "closed" });
    await expect(exchange.fetch(hash)).rejects.toMatchObject({ code: "closed" });
  });
});
