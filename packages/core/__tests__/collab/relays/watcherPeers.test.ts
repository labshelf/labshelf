/** Pins that the clients of a watched relay keep a watcher out of their blob fetches and do not flood its socket. */
import { derivePresenceShareKey, deriveContentShareKey, deriveRelayToken } from "../../../src/collab/shareKey/index";
import { createRelayWatch } from "../../../src/collab/relays/index";
import { attachShareBlobs, type ShareBlobExchange } from "../../../src/collab/doc/attachShareBlobs";
import type { RelayConnectionPort } from "../../../src/collab/transport/index";
import { deriveSha256Hex } from "../../../src/hash/index";
import { FakeClock } from "../peer/fakeNetwork";
import { fakeLogger, SHARE_ID, SHARE_KEY } from "../doc/testSession";
import { openRelayClient, RELAY_URL, type RelayClient } from "../transport/relay/relayClient";
import { FakeRelay, runFor } from "../transport/relay/fakeRelay";
import { TWO } from "./relayGroup";

const TEN_MINUTES_MS = 600_000;
const LETTERS = 20;
/** Two presences, one blob request per client at most, and one doc update per letter typed, with room for the opening sync. */
const WATCHER_MESSAGE_BOUND = 2 * LETTERS + 40;

const state = (name: string) => ({ name, colour: "#000000", file: null, anchor: null, head: null });

/** Counts the messages the relay delivers to the sockets this factory opens. */
function countingSockets(inner: (url: string) => RelayConnectionPort, counter: { received: number }): (url: string) => RelayConnectionPort {
  return (url) => {
    const socket = inner(url);
    let handler: RelayConnectionPort["onmessage"] = null;
    Object.defineProperty(socket, "onmessage", {
      get: () => handler,
      set: (fn: RelayConnectionPort["onmessage"]) => { handler = fn && ((event) => { counter.received += 1; fn(event); }); },
    });
    return socket;
  };
}

/** A relay client of the group on the watched relay, with blobs that skip the peers reporting another relay. */
async function openMember(relay: FakeRelay, clock: FakeClock, name: string, held?: Uint8Array): Promise<RelayClient & { blobs: ShareBlobExchange }> {
  const client = await openRelayClient(relay, clock);
  client.presence.setRelay({ relay: RELAY_URL, relaysDown: {} });
  client.presence.setLocal(state(name));
  const blobs = attachShareBlobs(client.session, {
    contentKey: await deriveContentShareKey(SHARE_KEY), getBlob: async () => held, logger: client.logger, scheduler: clock,
    skipPeer: (peer) => client.presence.reportsOtherRelay(peer),
  });
  return { ...client, blobs, close: async () => { blobs.close(); await client.close(); } };
}

describe("a relay watcher seen by the clients of the relay it watches", () => {
  it("gets no blob request and few messages while two clients type and exchange a blob for ten minutes", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const counter = { received: 0 };
    const logger = fakeLogger();
    const watch = createRelayWatch({
      shareId: SHARE_ID, relayToken: await deriveRelayToken(SHARE_KEY), contentKey: await deriveContentShareKey(SHARE_KEY),
      awarenessKey: await derivePresenceShareKey(SHARE_KEY), logger, scheduler: clock,
      fetch: relay.fetch, socketFactory: countingSockets(relay.socketFactory, counter),
    });
    const blob = new TextEncoder().encode("figure bytes");
    // The fetcher meets the watcher before the holder, so a fetch that asked every peer in turn would ask the watcher first.
    const fetcher = await openMember(relay, clock, "Grace");
    await runFor(clock, 1000);
    watch.publish({ ...state("Ada"), relay: TWO, relaysDown: {} });
    watch.follow([RELAY_URL], () => ({ failure: () => {}, connected: () => {} }));
    await runFor(clock, 5000);
    const holder = await openMember(relay, clock, "Ken", blob);
    await runFor(clock, 5000);

    let fetched: Uint8Array | undefined;
    void fetcher.blobs.fetch(await deriveSha256Hex(blob)).then((bytes) => { fetched = bytes; });
    await runFor(clock, 2000);
    expect(fetched && new TextDecoder().decode(fetched)).toBe("figure bytes");

    [fetcher, holder].forEach((client, i) => {
      const text = client.text();
      for (let n = 0; n < LETTERS; n += 1) { clock.after(n * 3000 + i * 1000, () => text.insert(text.length, "ab"[i]!)); }
    });
    await runFor(clock, TEN_MINUTES_MS, 1000);
    expect(fetcher.text().length).toBe(2 * LETTERS);
    expect(counter.received).toBeLessThan(WATCHER_MESSAGE_BOUND);

    await Promise.all([fetcher.close(), holder.close(), watch.close()]);
  }, 60_000);
});
