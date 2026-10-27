/** Pins that a link one side reopens, while the other keeps its own, still catches up whichever side reopened. */
import { createShareSession } from "../../../src/collab/doc/index";
import type { PeerId, PeerTransport } from "../../../src/collab/relays/index";
import { FakeClock, FakeNetwork, runUntil } from "./fakeNetwork";
import { contentKey, fakeLogger, openSession, SHARE_ID, type TestClient } from "../doc/testSession";

/** A transport that can announce an already connected peer again, as a relay or reconnect seen by one side only does. */
function reannouncing(transport: PeerTransport): { transport: PeerTransport; announce(peer: PeerId): void } {
  const joins = new Set<(peer: PeerId) => void>();
  return {
    transport: {
      get peers() { return transport.peers; },
      send: (to, bytes) => transport.send(to, bytes),
      onMessage: (fn) => transport.onMessage(fn),
      onPeerJoin: (fn) => { joins.add(fn); const stop = transport.onPeerJoin(fn); return () => { joins.delete(fn); stop(); }; },
      onPeerLeave: (fn) => transport.onPeerLeave(fn),
      close: () => transport.close(),
    },
    announce: (peer) => joins.forEach((fn) => fn(peer)),
  };
}

describe("secure mesh link reopened by one side", () => {
  let clock: FakeClock;
  let net: FakeNetwork;
  let clients: TestClient[] = [];
  beforeEach(() => { clock = new FakeClock(); net = new FakeNetwork(clock); });
  afterEach(async () => { await Promise.all(clients.map((c) => c.session.close())); clients = []; });

  it("syncs an index edit to the peer that saw the other join twice", async () => {
    const a = reannouncing(net.join("a"));
    const logger = fakeLogger();
    const memberA: TestClient = {
      id: "a", logger,
      session: createShareSession({ shareId: SHARE_ID, contentKey: await contentKey(), transport: a.transport, logger, scheduler: clock }),
    };
    const memberB = await openSession(net, clock, "b");
    clients = [memberA, memberB];
    memberB.session.index.getMap("probe").set("first", true);
    expect(await runUntil(clock, () => memberA.session.index.getMap("probe").get("first") === true)).toBe(true);
    await runUntil(clock, () => false, 5_000);

    memberB.session.index.getMap("probe").set("second", true);
    a.announce("b");

    expect(await runUntil(clock, () => memberA.session.index.getMap("probe").get("second") === true, 30_000)).toBe(true);
  });
  it("syncs to the peer that reopened its link, which adopts the kept link mid-sequence", async () => {
    const memberA = await openSession(net, clock, "a");
    const b = reannouncing(net.join("b"));
    const logger = fakeLogger();
    const memberB: TestClient = {
      id: "b", logger,
      session: createShareSession({ shareId: SHARE_ID, contentKey: await contentKey(), transport: b.transport, logger, scheduler: clock }),
    };
    clients = [memberA, memberB];
    memberA.session.index.getMap("probe").set("first", true);
    expect(await runUntil(clock, () => memberB.session.index.getMap("probe").get("first") === true)).toBe(true);
    await runUntil(clock, () => false, 5_000);

    b.announce("a");
    memberA.session.index.getMap("probe").set("fromA", true);

    expect(await runUntil(clock, () => memberB.session.index.getMap("probe").get("fromA") === true, 30_000)).toBe(true);
  });
});
