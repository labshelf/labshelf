/** Runs real share sessions over two in-process relays whose hosts can refuse, page for limits or be blocked per client. */
import * as Y from "yjs";
import { derivePresenceShareKey, deriveContentShareKey, deriveRelayToken } from "../../../src/collab/invite/index";
import {
  addRelay, createRelaySelector, createRelayWatch, createSwitchableTransport, startRelaySelectionFollow, createRelayPresence, createRelayProbe, createMemoryCursorStore,
  type RelayConnectionPort, type RelayCursorStore, type RelaySelector,
} from "../../../src/collab/relays/index";
import { attachPresence, type PresenceStore } from "../../../src/collab/peer/index";
import { createShareSession, type ShareSession } from "../../../src/collab/doc/index";
import type { FakeClock } from "../peer/fakeNetwork";
import { fakeLogger, SHARE_ID, SHARE_KEY } from "../doc/testSession";
import { FakeRelay } from "./fakeRelay";

export const ONE = "https://one.example.workers.dev";
export const TWO = "https://two.example.workers.dev";
const DOC_PATH = "main.tex";
const REFUSE_MS = 5;

/**
 * `limit`: every request gets Cloudflare's 429 and every socket drops. `refuseNew`: requests get a 503 and new sockets close
 * before they open, while open sockets live on. `limitPage`: as `refuseNew`, with Cloudflare's 1027 page as the answer.
 */
export type HostMode = "up" | "limit" | "refuseNew" | "limitPage";

/** A socket the relay closes before it opens. */
function refusedSocket(clock: FakeClock): RelayConnectionPort {
  const socket: RelayConnectionPort = {
    binaryType: "blob", onopen: null, onmessage: null, onclose: null, onerror: null,
    send: () => { throw new Error("send on a refused socket"); },
    close: () => {},
  };
  clock.after(REFUSE_MS, () => socket.onclose?.({ code: 1006, reason: "refused" }));
  return socket;
}

export class RelayHosts {
  private readonly relays = new Map<string, FakeRelay>();
  private readonly modes = new Map<string, HostMode>();
  /** Requests clients made, keyed by origin and path, counted before any block or mode answers them. */
  readonly requests = new Map<string, number>();
  constructor(private clock: FakeClock) { [ONE, TWO].forEach((url) => this.relays.set(new URL(url).host, new FakeRelay(clock))); }

  relay(url: string): FakeRelay { return this.relays.get(new URL(url).host)!; }

  set(url: string, mode: HostMode): void {
    this.modes.set(new URL(url).host, mode);
    if (mode === "limit") { this.relay(url).dropAll(); }
  }

  /** The fetch one client sees; hosts in `blocked` never answer it. */
  fetchFor(blocked: ReadonlySet<string>): typeof fetch {
    return async (input, init) => {
      const { host, origin, pathname } = new URL(String(input));
      this.requests.set(origin + pathname, (this.requests.get(origin + pathname) ?? 0) + 1);
      if (blocked.has(host)) { throw new TypeError("fetch failed"); }
      const mode = this.modes.get(host) ?? "up";
      if (mode === "limit") { return new Response("error code: 1027", { status: 429 }); }
      if (mode === "limitPage") { return new Response("<html>error code: 1027</html>", { status: 503 }); }
      if (mode === "refuseNew") { return new Response("refused", { status: 503 }); }
      return this.relays.get(host)!.fetch(input, init);
    };
  }

  socketFactoryFor(blocked: ReadonlySet<string>): (url: string) => RelayConnectionPort {
    return (url) => {
      const host = new URL(url).host;
      const mode = this.modes.get(host) ?? "up";
      if (blocked.has(host) || mode === "refuseNew" || mode === "limitPage") { return refusedSocket(this.clock); }
      return this.relays.get(host)!.socketFactory(url);
    };
  }
}

export interface GroupClient { session: ShareSession; selector: RelaySelector; presence: PresenceStore; text(): Y.Text; close(): Promise<void> }

export interface GroupClientOptions {
  owner?: boolean;
  cursors?: Map<string, RelayCursorStore>;
  /** Hosts this client cannot reach, as behind a network that blocks them. */
  blocked?: ReadonlySet<string>;
  /** The relays the owner lists and the invite carries; both by default. */
  relays?: readonly string[];
}

export async function openGroupClient(hosts: RelayHosts, clock: FakeClock, name: string, options: GroupClientOptions = {}): Promise<GroupClient> {
  const { owner = false, cursors, blocked = new Set<string>(), relays = [ONE, TWO] } = options;
  const logger = fakeLogger();
  const contentKey = await deriveContentShareKey(SHARE_KEY);
  const slot = createSwitchableTransport();
  const session = createShareSession({ shareId: SHARE_ID, contentKey, transport: slot, logger, scheduler: clock });
  if (owner) { relays.forEach((url) => addRelay(session.index, { url, addedBy: name })); }
  const awarenessKey = await derivePresenceShareKey(SHARE_KEY);
  const relayToken = await deriveRelayToken(SHARE_KEY);
  const presence = attachPresence(session, { awarenessKey, logger });
  presence.setLocal({ name, colour: "#000000", file: null, anchor: null, head: null });
  const fetch = hosts.fetchFor(blocked);
  const socketFactory = hosts.socketFactoryFor(blocked);
  const watch = createRelayWatch({ shareId: SHARE_ID, relayToken, contentKey, awarenessKey, logger, scheduler: clock, fetch, socketFactory });
  const selector = createRelaySelector({
    index: session.index, inviteRelays: relays, probe: createRelayProbe({ logger, fetch, scheduler: clock }),
    presence: createRelayPresence(presence, watch), clock, logger,
  });
  const follower = startRelaySelectionFollow({
    session, slot, selector, shareId: SHARE_ID, relayToken, contentKey, logger,
    scheduler: clock, fetch, socketFactory, isSnapshotWriter: () => presence.isLowestId(),
    ...(cursors ? { cursorsFor: (url: string) => cursors.get(url) ?? cursors.set(url, createMemoryCursorStore()).get(url)! } : {}),
  });
  session.openDoc(DOC_PATH);
  return {
    session, selector, presence,
    text: () => session.openDoc(DOC_PATH).getText("body"),
    close: async () => {
      await follower.close();
      selector.close();
      await watch.close();
      await presence.close();
      await session.close();
    },
  };
}

/** Types `count` letters into `client`, one every 300 ms. */
export function typeFor(clock: FakeClock, client: GroupClient, letter: string, count: number): void {
  const step = (left: number) => {
    client.text().insert(client.text().length, letter);
    if (left > 1) { clock.after(300, () => step(left - 1)); }
  };
  step(count);
}
