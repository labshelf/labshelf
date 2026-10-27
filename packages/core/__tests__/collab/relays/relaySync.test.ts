/** Pins relay sync: stored frames, snapshots, put retry, a restart, and convergence of share sessions that meet only through a fake relay. */
import * as Y from "yjs";
import { readShareIndexDocFiles, INDEX_DOC_KEY } from "../../../src/collab/index";
import { decodeEnvelope, MESSAGE_KIND, createDocIdCache, CHANNEL_KIND } from "../../../src/collab/index";
import {
  createMemoryCursorStore, PUT_INTERVAL_MS, SNAPSHOT_AFTER_PUTS, type RelayCursorStore,
} from "../../../src/collab/relays/index";
import { openStored, sealStored } from "../../../src/collab/relays/relaySync";
import { contentKey, SHARE_ID } from "../testSession";
import { FakeClock, runUntil, seededRandom } from "../fakeNetwork";
import { FakeRelay, runFor } from "./fakeRelay";
import { DOC_PATH, openRelayClient, type RelayClient } from "./relayClient";

describe("stored frames", () => {
  it("seals an update with epoch and seq 0 and opens it for its doc only", async () => {
    const context = { shareId: SHARE_ID, key: await contentKey(), docIdOf: createDocIdCache(SHARE_ID) };
    const payload = new Uint8Array([1, 2, 3]);
    const { message } = await sealStored(context, MESSAGE_KIND.update, "main.typ", payload);
    const decoded = decodeEnvelope(message);
    expect(decoded.ok && { epoch: decoded.envelope.epoch, seq: decoded.envelope.seq }).toEqual({ epoch: 0n, seq: 0 });
    expect(await openStored(context, "main.typ", message)).toEqual(payload);
    expect(await openStored(context, "other.typ", message)).toBeUndefined();
  });
});

describe("relay snapshots", () => {
  it("sends one snapshot when three clients reach 500 updates, and logs no refusal", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const clients: RelayClient[] = await Promise.all([1, 2, 3].map(() => openRelayClient(relay, clock)));
    clients.forEach((client, i) => client.presence.setLocal({ name: `c${i}`, colour: "#000000", file: null, anchor: null, head: null }));
    await runFor(clock, 1000);
    for (let i = 0; i < SNAPSHOT_AFTER_PUTS + 5; i += 1) {
      const client = clients[i % clients.length]!;
      client.text().insert(client.text().length, "x");
      await client.relaySync.flush();
      await runFor(clock, 100);
    }
    await runFor(clock, 2000);

    expect(relay.counts.snapshot).toBe(1);
    expect(relay.snapshots.size).toBe(1);
    expect(clients.map((client) => client.text().length)).toEqual([SNAPSHOT_AFTER_PUTS + 5, SNAPSHOT_AFTER_PUTS + 5, SNAPSHOT_AFTER_PUTS + 5]);
    await Promise.all(clients.map((client) => client.close()));
  }, 120_000);

  it("logs a stale snapshot refusal as information, not as a warning", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    relay.staleSnapshots = true;
    const writer = await openRelayClient(relay, clock);
    await runFor(clock, 1000);
    for (let i = 0; i < SNAPSHOT_AFTER_PUTS; i += 1) {
      writer.text().insert(0, "x");
      await writer.relaySync.flush();
      await runFor(clock, 100);
    }
    await runFor(clock, 1000);
    expect(relay.counts.snapshot).toBe(1);
    const levels = writer.logger.log.mock.calls.map(([level, , message]) => `${level} ${message}`);
    expect(levels.some((line) => line.startsWith("INFO") && /stale/i.test(line))).toBe(true);
    expect(levels.some((line) => line.startsWith("WARN") && /refused a request/.test(line))).toBe(false);
    await writer.close();
  }, 120_000);
});

describe("relay put retry", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps the update when sealing fails once, logs an error and puts it in the next window", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const client = await openRelayClient(relay, clock);
    await runFor(clock, 1000);
    const failure = new Error("encrypt failed");
    jest.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(failure);

    client.text().insert(0, "kept");
    await runFor(clock, PUT_INTERVAL_MS + 500);
    expect(relay.counts.put).toBe(0);
    expect(client.logger.error).toHaveBeenCalledTimes(1);
    const [, error, context] = client.logger.error.mock.calls[0]!;
    expect(error).toBe(failure);
    expect(context).toMatchObject({ shareId: expect.any(String), docKey: "main.tex" });

    await runFor(clock, PUT_INTERVAL_MS + 500);
    expect(relay.counts.put).toBe(1);
    expect(client.logger.error).toHaveBeenCalledTimes(1);
    await client.close();
  });
});

/** Restores a doc as a fresh process does from the device's stored state. */
const restored = (doc: Y.Doc): Y.Doc => { const copy = new Y.Doc(); Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc)); return copy; };

describe("relay sync across a restart", () => {
  let clock: FakeClock;
  let relay: FakeRelay;
  let cursors: RelayCursorStore;
  let stored: Y.Doc;

  beforeEach(async () => {
    clock = new FakeClock();
    relay = new FakeRelay(clock);
    cursors = createMemoryCursorStore();
    stored = new Y.Doc();
    const first = await openRelayClient(relay, clock, [stored], cursors);
    await runFor(clock, 1000);
    first.text().insert(0, "shared ");
    await runFor(clock, 3000);
    await first.close();
    expect(relay.counts.put).toBe(1);
  });

  it("puts edits made without a relay connection in an earlier process", async () => {
    stored.getText("body").insert(7, "offline ");
    const restarted = await openRelayClient(relay, clock, [restored(stored)], cursors);
    await runFor(clock, 3000);
    await restarted.close();

    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "shared offline ", 10_000)).toBe(true);
    await fresh.close();
  });

  it("puts nothing on a restart when the relay holds every local edit", async () => {
    const restarted = await openRelayClient(relay, clock, [restored(stored)], cursors);
    await runFor(clock, 3000);
    await restarted.close();
    expect(relay.counts.put).toBe(1);
  });

  it("puts a delete made without a relay connection, which adds no clock", async () => {
    stored.getText("body").delete(0, 1);
    const restarted = await openRelayClient(relay, clock, [restored(stored)], cursors);
    await runFor(clock, 3000);
    await restarted.close();

    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "hared ", 10_000)).toBe(true);
    await fresh.close();
  });

  it("catches up from the first row once when a cursor has no held state, then holds everything", async () => {
    const key = DOC_PATH;
    const withoutHeld = createMemoryCursorStore();
    withoutHeld.set(key, 5);
    const restarted = await openRelayClient(relay, clock, [restored(stored)], withoutHeld);
    await runFor(clock, 3000);
    expect(restarted.text().toString()).toBe("shared ");
    await restarted.close();
    expect(withoutHeld.held(key)).toBeDefined();
    expect(relay.counts.put).toBe(1);
    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "shared ", 10_000)).toBe(true);
    await fresh.close();
  });

  it("only puts when the held state lags the relay", async () => {
    const lagging = createMemoryCursorStore();
    lagging.set(DOC_PATH, 0);
    lagging.setHeld(DOC_PATH, Y.encodeSnapshot(Y.snapshot(new Y.Doc())));
    const restarted = await openRelayClient(relay, clock, [restored(stored)], lagging);
    await runFor(clock, 3000);
    expect(restarted.text().toString()).toBe("shared ");
    await restarted.close();

    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "shared ", 10_000)).toBe(true);
    await fresh.close();
  });
});

const PATHS = ["main.tex", "intro.tex", "refs.tex"];

function snapshot(client: RelayClient): string {
  const docs = [...client.session.docs()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(docs.map(([key, doc]) => [key, Object.entries(doc.getMap("files").toJSON()).sort(), doc.getText("body").toString()]));
}

const converged = (clients: RelayClient[]) => clients.every((c) => snapshot(c) === snapshot(clients[0]!));

function randomEdits(clients: RelayClient[], random: () => number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const c = clients[Math.floor(random() * clients.length)]!;
    const path = PATHS[Math.floor(random() * PATHS.length)]!;
    readShareIndexDocFiles(c.session.index).set(path, { kind: "text" });
    if (random() < 0.3) { continue; }
    const body = c.session.openDoc(path).getText("body");
    body.insert(Math.floor(random() * (body.length + 1)), `${i} `);
  }
}

describe("share sessions over the relay", () => {
  let clock: FakeClock;
  let relay: FakeRelay;
  let clients: RelayClient[] = [];
  beforeEach(() => { clock = new FakeClock(); relay = new FakeRelay(clock); });
  afterEach(async () => { await Promise.all(clients.map((c) => c.close())); clients = []; });

  it("converges two clients typing into the same doc at once", async () => {
    clients = await Promise.all([openRelayClient(relay, clock), openRelayClient(relay, clock)]);
    await runFor(clock, 1000);
    const [a, b] = clients as [RelayClient, RelayClient];
    a.text().insert(0, "left ");
    b.text().insert(0, "right ");
    expect(await runUntil(clock, () => a.text().length === 11 && a.text().toString() === b.text().toString(), 20_000)).toBe(true);
    expect(a.text().toString()).toContain("left ");
    expect(a.text().toString()).toContain("right ");
  });

  it("converges three clients after random concurrent edits to the index and file docs", async () => {
    clients = await Promise.all([1, 2, 3].map(() => openRelayClient(relay, clock)));
    await runFor(clock, 1000);
    const random = seededRandom(3);
    for (let round = 0; round < 4; round += 1) {
      randomEdits(clients, random, 15);
      await runFor(clock, 700);
    }
    expect(await runUntil(clock, () => converged(clients) && clients.every((c) => c.session.docs().size === PATHS.length + 1), 30_000)).toBe(true);
    expect(clients[0]!.session.docs().has(INDEX_DOC_KEY)).toBe(true);
  }, 60_000);

  it("catches a late client up on what the others wrote, and delivers its own edit to them", async () => {
    clients = await Promise.all([openRelayClient(relay, clock), openRelayClient(relay, clock)]);
    await runFor(clock, 1000);
    randomEdits(clients, seededRandom(5), 30);
    expect(await runUntil(clock, () => converged(clients), 30_000)).toBe(true);
    const late = await openRelayClient(relay, clock);
    clients.push(late);
    expect(await runUntil(clock, () => converged(clients), 30_000)).toBe(true);
    late.text().insert(0, "late ");
    expect(await runUntil(clock, () => clients[0]!.text().toString().startsWith("late ") && converged(clients), 20_000)).toBe(true);
  }, 60_000);

  it("shows each client the cursor and presence of the others, forwarded and never stored", async () => {
    clients = await Promise.all([1, 2, 3].map(() => openRelayClient(relay, clock)));
    await runFor(clock, 1000);
    clients.forEach((c, i) => c.presence.setLocal({ name: "abc"[i]!, colour: "#000000", file: "main.tex", anchor: String(i), head: String(i) }));
    expect(await runUntil(clock, () => clients.every((c) => c.presence.remote().size === 2), 20_000)).toBe(true);
    for (const [i, c] of clients.entries()) {
      const seen = [...c.presence.remote().values()].map((state) => `${state.name}@${state.head}`).sort();
      expect(seen).toEqual(["a@0", "b@1", "c@2"].filter((_, j) => j !== i));
    }
    expect(relay.forwardKinds.get(CHANNEL_KIND.awareness)).toBeGreaterThan(0);
    expect(relay.counts.put).toBe(0);
  });
});
