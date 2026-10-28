/** Pins the relay watch: a newcomer that cannot use the group's relay brings the whole group to its relay within seconds, the watcher costs the group little, failures are held down, and the probe's verdicts. */
import { derivePresenceShareKey, deriveContentShareKey, deriveRelayToken } from "../../../src/collab/invite/index";
import {
  createRelayProbe, createRelayWatch, PROBE_TIMEOUT_MS, RELAY_DOWN_HOLD_MS, type RelayConnectionPort,
} from "../../../src/collab/relays/index";
import { attachShareBlobs, type ShareBlobExchange } from "../../../src/collab/index";
import { deriveSha256Hex } from "../../../src/hash/index";
import { RELAY_PATH } from "../../../src/relay/index";
import { FakeClock, runUntil } from "../fakeNetwork";
import { fakeLogger, SHARE_ID, SHARE_KEY } from "../testSession";
import { openRelayClient, RELAY_URL, type RelayClient } from "./relayClient";
import { FakeRelay, runFor } from "./fakeRelay";
import { ONE, openGroupClient, RelayHosts, TWO, typeFor, type GroupClient } from "./relayGroup";

const sorted = (client: GroupClient) => [...client.text().toString()].sort().join("");
const CONVERGED = "AAAABBBBCCCCaaaaa";
const relays = (clients: GroupClient[]) => clients.map((client) => client.selector.current);

async function groupOnOne(clock: FakeClock, hosts: RelayHosts): Promise<GroupClient[]> {
  const a = await openGroupClient(hosts, clock, "Ada", { owner: true });
  const b = await openGroupClient(hosts, clock, "Grace");
  await runFor(clock, 5000);
  typeFor(clock, a, "a", 5);
  await runFor(clock, 5000);
  return [a, b];
}

async function expectConverged(clock: FakeClock, clients: GroupClient[]): Promise<void> {
  clients.forEach((client, i) => typeFor(clock, client, "ABC"[i]!, 4));
  const [first, ...rest] = clients;
  // TRAP: under load virtual time outruns the real WebCrypto work, so convergence is awaited rather than timed.
  await runUntil(clock, () => sorted(first!) === CONVERGED && rest.every((client) => client.text().toString() === first!.text().toString()), 60_000, 100);
  expect(sorted(first!)).toBe(CONVERGED);
  rest.forEach((client) => expect(client.text().toString()).toBe(first!.text().toString()));
}

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

describe("relay watch", () => {
  it("moves the group to the newcomer's relay within 30 s when its relay refuses new sockets but answers /version", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const [a, b] = await groupOnOne(clock, hosts);
    hosts.set(ONE, "refuseNew");
    const c = await openGroupClient(hosts, clock, "Ken");
    await runFor(clock, 30_000, 100);
    expect(relays([a!, b!, c])).toEqual([TWO, TWO, TWO]);
    await expectConverged(clock, [a!, b!, c]);
    await Promise.all([a!, b!, c].map((client) => client.close()));
  }, 60_000);

  it("moves the group within 30 s when a newcomer's network blocks the group's relay", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const [a, b] = await groupOnOne(clock, hosts);
    const c = await openGroupClient(hosts, clock, "Ken", { blocked: new Set([new URL(ONE).host]) });
    await runFor(clock, 30_000, 100);
    expect(relays([a!, b!, c])).toEqual([TWO, TWO, TWO]);
    await expectConverged(clock, [a!, b!, c]);
    await Promise.all([a!, b!, c].map((client) => client.close()));
  }, 60_000);

  it("keeps one watch socket per other relay for the whole group and hands it over when the watcher leaves", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const group = await groupOnOne(clock, hosts);
    group.push(await openGroupClient(hosts, clock, "Ken"));
    await runFor(clock, 10_000, 100);
    expect(relays(group)).toEqual([ONE, ONE, ONE]);
    // A later client with a lower awareness id takes the watch over, so opens can exceed one; open sockets cannot.
    expect(hosts.relay(TWO).live).toBe(1);
    const opens = hosts.relay(TWO).counts.opens;

    const watcher = group.find((client) => client.presence.isLowestId())!;
    await watcher.close();
    await runFor(clock, 10_000, 100);
    expect(hosts.relay(TWO).live).toBe(1);
    expect(hosts.relay(TWO).counts.opens).toBe(opens + 1);
    await Promise.all(group.filter((client) => client !== watcher).map((client) => client.close()));
  }, 60_000);
});

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

describe("relay watch listeners", () => {
  it("stops calling a change listener once its unsubscribe has run", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const watch = createRelayWatch({
      shareId: SHARE_ID, relayToken: await deriveRelayToken(SHARE_KEY), contentKey: await deriveContentShareKey(SHARE_KEY),
      awarenessKey: await derivePresenceShareKey(SHARE_KEY), logger: fakeLogger(), scheduler: clock,
      fetch: relay.fetch, socketFactory: relay.socketFactory,
    });
    const listener = jest.fn();
    const unsubscribe = watch.onChange(listener);
    watch.follow([RELAY_URL], () => ({ failure: () => {}, connected: () => {} }));
    await runFor(clock, 5000);
    const client = await openRelayClient(relay, clock);
    client.presence.setLocal(state("Ken"));
    await runFor(clock, 3000);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const calls = listener.mock.calls.length;
    client.presence.setLocal(state("Grace"));
    await runFor(clock, 3000);
    expect(watch.reports().length).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledTimes(calls);
    await Promise.all([client.close(), watch.close()]);
  }, 60_000);
});

describe("relay watch failures", () => {
  it("asks a relay the watcher's network blocks for at most three watch tickets in an hour", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const watcher = await openGroupClient(hosts, clock, "Ada", { owner: true, blocked: new Set([new URL(TWO).host]) });
    await runFor(clock, RELAY_DOWN_HOLD_MS - 10_000, 10_000);
    expect(watcher.selector.current).toBe(ONE);
    expect(watcher.presence.isLowestId()).toBe(true);
    const tickets = hosts.requests.get(TWO + RELAY_PATH.ticket) ?? 0;
    expect(tickets).toBeGreaterThan(0);
    expect(tickets).toBeLessThanOrEqual(3);
    await watcher.close();
  }, 60_000);
});

const URL_ONE = "https://one.example.workers.dev";
const answer = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

describe("relay probe", () => {
  it("accepts a Worker of the same major and refuses another major", async () => {
    const clock = new FakeClock();
    const same = createRelayProbe({ logger: fakeLogger(), scheduler: clock, fetch: answer({ v: "2.4", worker: "2.4.2" }) });
    const other = createRelayProbe({ logger: fakeLogger(), scheduler: clock, fetch: answer({ v: "3.0", worker: "3.0.0" }) });
    expect(await same(URL_ONE)).toBe("ok");
    expect(await other(URL_ONE)).toBe("error");
  });

  it("gives up on a relay that does not answer within the timeout", async () => {
    const clock = new FakeClock();
    const silent = createRelayProbe({ logger: fakeLogger(), scheduler: clock, fetch: () => new Promise<Response>(() => {}) });
    const result = silent(URL_ONE);
    clock.advance(PROBE_TIMEOUT_MS);
    expect(await result).toBe("error");
  });

  it("calls a 429 or Cloudflare's 1027 page a limit refusal", async () => {
    const clock = new FakeClock();
    const page = (status: number) => createRelayProbe({
      logger: fakeLogger(), scheduler: clock, fetch: async () => new Response("<html>error code: 1027</html>", { status }),
    });
    expect(await page(429)(URL_ONE)).toBe("limit");
    expect(await page(503)(URL_ONE)).toBe("limit");
  });
});
