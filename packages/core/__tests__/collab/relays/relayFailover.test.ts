/** Pins failover on real sessions over two in-process relays: the group moves together on a 429 and no edit is lost. */
import * as Y from "yjs";
import { deriveAwarenessKey, deriveContentKey, deriveRelayToken } from "../../../src/collab/crypto/index";
import {
  addRelay, createRelaySelector, createSwitchableTransport, followRelaySelection, relayPresence, RELAY_DOWN_HOLD_MS, type RelaySelector,
} from "../../../src/collab/relays/index";
import {
  attachAwareness, createShareSession, memoryCursorStore, type RelayCursorStore, type ShareSession,
} from "../../../src/collab/sync/index";
import type { RelaySocket } from "../../../src/collab/transport/index";
import { FakeClock } from "../sync/fakeNetwork";
import { fakeLogger, SHARE_ID, SHARE_KEY } from "../sync/testSession";
import { FakeRelay, runFor } from "../transport/relay/fakeRelay";

const ONE = "https://one.example.workers.dev";
const TWO = "https://two.example.workers.dev";
const DOC_PATH = "main.tex";

/** Two fake relays behind their URLs; a limited one answers every request with Cloudflare's 429 page. */
class RelayPair {
  readonly relays = new Map<string, FakeRelay>();
  readonly limited = new Set<string>();
  constructor(clock: FakeClock) { [ONE, TWO].forEach((url) => this.relays.set(new URL(url).host, new FakeRelay(clock))); }

  relay(url: string): FakeRelay { return this.relays.get(new URL(url).host)!; }

  limit(url: string, on: boolean): void {
    const host = new URL(url).host;
    if (on) { this.limited.add(host); this.relay(url).dropAll(); } else { this.limited.delete(host); }
  }

  fetch: typeof fetch = async (input, init) => {
    const host = new URL(String(input)).host;
    if (this.limited.has(host)) { return new Response("error code: 1027", { status: 429 }); }
    return this.relays.get(host)!.fetch(input, init);
  };

  socketFactory = (url: string): RelaySocket => this.relays.get(new URL(url).host)!.socketFactory(url);
  probe = async (url: string): Promise<boolean> => !this.limited.has(new URL(url).host);
}

interface Client { session: ShareSession; selector: RelaySelector; text(): Y.Text; close(): Promise<void> }

async function openClient(
  pair: RelayPair, clock: FakeClock, name: string, owner = false, cursors?: Map<string, RelayCursorStore>,
): Promise<Client> {
  const logger = fakeLogger();
  const contentKey = await deriveContentKey(SHARE_KEY);
  const slot = createSwitchableTransport();
  const session = createShareSession({ shareId: SHARE_ID, contentKey, transport: slot, logger, scheduler: clock });
  if (owner) { [ONE, TWO].forEach((url) => addRelay(session.index, { url, addedBy: name })); }
  const presence = attachAwareness(session, { awarenessKey: await deriveAwarenessKey(SHARE_KEY), logger });
  presence.setLocal({ name, colour: "#000000", file: null, anchor: null, head: null });
  const selector = createRelaySelector({
    index: session.index, inviteRelays: [ONE, TWO], probe: pair.probe, presence: relayPresence(presence), clock, logger,
  });
  const follower = followRelaySelection({
    session, slot, selector, shareId: SHARE_ID, relayToken: await deriveRelayToken(SHARE_KEY), contentKey, logger,
    scheduler: clock, fetch: pair.fetch, socketFactory: pair.socketFactory,
    ...(cursors ? { cursorsFor: (url: string) => cursors.get(url) ?? cursors.set(url, memoryCursorStore()).get(url)! } : {}),
  });
  session.openDoc(DOC_PATH);
  return {
    session, selector,
    text: () => session.openDoc(DOC_PATH).getText("body"),
    close: async () => {
      await follower.close();
      selector.close();
      await presence.close();
      await session.close();
    },
  };
}

function typeFor(clock: FakeClock, client: Client, letter: string, count: number): void {
  const step = (left: number) => {
    client.text().insert(client.text().length, letter);
    if (left > 1) { clock.after(300, () => step(left - 1)); }
  };
  step(count);
}

describe("relay failover", () => {
  it("moves every client to the next relay on a 429 without losing an edit, and back after the hold", async () => {
    const clock = new FakeClock();
    const pair = new RelayPair(clock);
    const a = await openClient(pair, clock, "Ada", true);
    const b = await openClient(pair, clock, "Grace");
    await runFor(clock, 5000);
    expect([a.selector.current, b.selector.current]).toEqual([ONE, ONE]);
    typeFor(clock, a, "a", 10);
    typeFor(clock, b, "b", 10);
    await runFor(clock, 5000);

    typeFor(clock, a, "A", 40);
    typeFor(clock, b, "B", 40);
    await runFor(clock, 1500);
    pair.limit(ONE, true);
    await runFor(clock, 30_000);
    expect([a.selector.current, b.selector.current]).toEqual([TWO, TWO]);
    const text = a.text().toString();
    expect(b.text().toString()).toBe(text);
    expect([...text].sort().join("")).toBe(`${"A".repeat(40)}${"B".repeat(40)}${"a".repeat(10)}${"b".repeat(10)}`);

    await a.close();
    await b.close();
    const late = await openClient(pair, clock, "Ken");
    await runFor(clock, 5000);
    expect(late.selector.current).toBe(TWO);
    expect(late.session.peers).toEqual([]);
    expect(late.text().toString()).toBe(text);

    pair.limit(ONE, false);
    late.text().insert(0, "x");
    // The late client held ONE down itself after three silent probes, so its own hour runs a little past the limit.
    await runFor(clock, RELAY_DOWN_HOLD_MS + 300_000, 5000);
    expect(late.selector.current).toBe(ONE);
    await runFor(clock, 5000);
    await late.close();
    const back = await openClient(pair, clock, "Barbara");
    await runFor(clock, 5000);
    expect(back.selector.current).toBe(ONE);
    expect(back.text().toString()).toBe(`x${text}`);
    await back.close();
  }, 120_000);

  it("gives a relay it returns to the edits made while the group was on another one, even with stored cursors", async () => {
    const clock = new FakeClock();
    const pair = new RelayPair(clock);
    const a = await openClient(pair, clock, "Ada", true, new Map());
    await runFor(clock, 5000);
    a.text().insert(0, "1");
    await runFor(clock, 5000);
    pair.limit(ONE, true);
    await runFor(clock, 10_000);
    expect(a.selector.current).toBe(TWO);
    a.text().insert(1, "2");
    await runFor(clock, 5000);
    pair.limit(ONE, false);
    await runFor(clock, RELAY_DOWN_HOLD_MS, 5000);
    expect(a.selector.current).toBe(ONE);
    await runFor(clock, 5000);
    await a.close();

    pair.limit(TWO, true);
    const late = await openClient(pair, clock, "Ken");
    await runFor(clock, 5000);
    expect(late.selector.current).toBe(ONE);
    expect(late.text().toString()).toBe("12");
    await late.close();
  }, 60_000);
});
