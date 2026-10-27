/** Pins the relay path: an hour of typing within the free plan, catch-up with nobody online, reconnects after a drop, and the claim and ticket requests. */
import { createHash } from "node:crypto";
import {
  addRelayShare, createRelayPresence, createRelayProbe, createRelaySelector, fetchTicket, PUT_INTERVAL_MS, RelayRequestError, SNAPSHOT_AFTER_PUTS,
} from "../../../src/collab/relays/index";
import { MESSAGE_KIND } from "../../../src/collab/index";
import { ONE, openGroupClient, RelayHosts, TWO } from "./relayGroup";
import { FakeClock, seededRandom } from "../fakeNetwork";
import { FakeRelay, runFor } from "./fakeRelay";
import { openRelayClient, RELAY_URL, type RelayClient } from "./relayClient";

const SHARE_ID = "a".repeat(32);

interface Seen { url: string; body: unknown; authorization?: string }

function answering(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return async (input, init) => {
    const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)), ...(authorization ? { authorization } : {}) });
    return new Response(JSON.stringify(body), { status });
  };
}

const HOUR_MS = 60 * 60 * 1000;
/** One relay leaves no other relay to watch. */
const idleWatch = { follow: () => {}, publish: () => {}, reports: () => [], onChange: () => () => {}, close: async () => {} };
const KEY_INTERVAL_MS = 300;

/** Each typist types bursts of 20 to 80 characters, one per 300 ms, then pauses 5 to 60 s. */
function scriptTypist(clock: FakeClock, client: Pick<RelayClient, "text" | "presence">, letter: string, seed: number, untilMs: number): void {
  const random = seededRandom(seed);
  // One timer at a time: the fake clock scans every pending timer whenever one fires.
  const type = (left: number) => {
    if (clock.now() >= untilMs) { return; }
    const text = client.text();
    const index = Math.floor(random() * (text.length + 1));
    text.insert(index, letter);
    client.presence.setLocal({ name: letter, colour: "#000000", file: "main.tex", anchor: String(index), head: String(index) });
    if (left > 1) { clock.after(KEY_INTERVAL_MS, () => type(left - 1)); return; }
    clock.after(5000 + Math.floor(random() * 55_000), () => type(20 + Math.floor(random() * 60)));
  };
  clock.after(Math.floor(random() * 5000), () => type(20 + Math.floor(random() * 60)));
}

describe("relay transport and relay sync", () => {
  it("keeps three typists of an hour under 2,000 billed relay requests, with at most one put per doc every 2 s", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const clients = await Promise.all([1, 2, 3].map(() => openRelayClient(relay, clock)));
    // Each client also re-probes its relay's /version every minute, as a relay selector does.
    const selectors = clients.map((client) => createRelaySelector({
      index: client.session.index, inviteRelays: [RELAY_URL], presence: createRelayPresence(client.presence, idleWatch), clock, logger: client.logger,
      probe: createRelayProbe({ logger: client.logger, fetch: relay.fetch, scheduler: clock }),
    }));
    await runFor(clock, 2000);
    const start = clock.now();
    clients.forEach((client, i) => scriptTypist(clock, client, "abc"[i]!, i + 7, start + HOUR_MS));
    await runFor(clock, HOUR_MS + 10_000, 100);

    const texts = clients.map((client) => client.text().toString());
    expect(texts[0]!.length).toBeGreaterThan(5000);
    expect(new Set(texts).size).toBe(1);
    const gaps = [...relay.putTimes.values()].flatMap((times) => times.slice(1).map((at, i) => at - times[i]!));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(PUT_INTERVAL_MS);
    expect(relay.counts.snapshot).toBeGreaterThan(0);
    expect(relay.forwardKinds.get(MESSAGE_KIND.update)).toBeUndefined();
    process.stdout.write(`relay hour: ${JSON.stringify({ ...relay.counts, billed: relay.billed, chars: texts[0]!.length })}\n`);
    expect(relay.billed).toBeLessThan(2000);
    selectors.forEach((selector) => selector.close());
    await Promise.all(clients.map((client) => client.close()));
  }, 300_000);

  it("keeps three typists of an hour on one relay and their watch on the other under 2,000 billed requests on each", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const clients = [await openGroupClient(hosts, clock, "a", { owner: true })];
    clients.push(...await Promise.all(["b", "c"].map((name) => openGroupClient(hosts, clock, name))));
    await runFor(clock, 5000);
    expect(clients.map((client) => client.selector.current)).toEqual([ONE, ONE, ONE]);
    expect(hosts.relay(TWO).live).toBe(1);
    const start = clock.now();
    clients.forEach((client, i) => scriptTypist(clock, client, "abc"[i]!, i + 7, start + HOUR_MS));
    await runFor(clock, HOUR_MS + 10_000, 100);

    const texts = clients.map((client) => client.text().toString());
    expect(texts[0]!.length).toBeGreaterThan(5000);
    expect(new Set(texts).size).toBe(1);
    const billed = { one: hosts.relay(ONE).billed, two: hosts.relay(TWO).billed };
    process.stdout.write(`two-relay hour: ${JSON.stringify({ ...billed, one_counts: hosts.relay(ONE).counts, two_counts: hosts.relay(TWO).counts })}\n`);
    expect(billed.one).toBeLessThan(2000);
    expect(billed.two).toBeLessThan(2000);
    await Promise.all(clients.map((client) => client.close()));
  }, 300_000);

  it("starts the next put window when a slow put is sent, not when its window ended", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const client = await openRelayClient(relay, clock);
    await runFor(clock, 2000);
    client.text().insert(0, "a");
    // Synchronous advances run the window timer while the put still seals, as on a loaded machine.
    clock.advance(PUT_INTERVAL_MS + 1000);
    client.text().insert(1, "b");
    clock.advance(1500);
    await runFor(clock, 3 * PUT_INTERVAL_MS);

    const [times] = [...relay.putTimes.values()];
    expect(times).toHaveLength(2);
    expect(times![1]! - times![0]!).toBeGreaterThanOrEqual(PUT_INTERVAL_MS);
    await client.close();
  });

  it("catches a client up from the relay alone when nobody else is online", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const writer = await openRelayClient(relay, clock);
    await runFor(clock, 1000);
    for (let i = 0; i < SNAPSHOT_AFTER_PUTS + 40; i += 1) {
      writer.text().insert(writer.text().length, "x");
      await runFor(clock, PUT_INTERVAL_MS + 100, 500);
    }
    await writer.close();
    await runFor(clock, 1000);
    expect(relay.snapshots.size).toBe(1);

    const late = await openRelayClient(relay, clock);
    await runFor(clock, 3000);
    expect(late.session.peers).toEqual([]);
    expect(late.text().toString()).toBe("x".repeat(SNAPSHOT_AFTER_PUTS + 40));
    await late.close();
  }, 120_000);

  it("seeds a fresh relay with what a client already holds", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const { Doc } = await import("yjs");
    const held = new Doc();
    held.getText("body").insert(0, "written before the relay existed");
    const owner = await openRelayClient(relay, clock, [held]);
    await runFor(clock, 3000);
    await owner.close();
    const late = await openRelayClient(relay, clock);
    await runFor(clock, 3000);
    expect(late.text().toString()).toBe("written before the relay existed");
    await late.close();
  });

  it("reconnects after the relay drops its sockets and delivers the edits made meanwhile", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const [a, b] = await Promise.all([openRelayClient(relay, clock), openRelayClient(relay, clock)]);
    await runFor(clock, 1000);
    a!.text().insert(0, "before ");
    await runFor(clock, 3000);
    expect(b!.text().toString()).toBe("before ");

    relay.up = false;
    relay.dropAll();
    await runFor(clock, 50);
    a!.text().insert(a!.text().length, "during");
    await runFor(clock, 5000);
    relay.up = true;
    await runFor(clock, 70_000);
    expect(b!.text().toString()).toBe("before during");
    expect(a!.relay.connected && b!.relay.connected).toBe(true);
    expect(a!.logger.log).toHaveBeenCalledWith("WARN", "collab.relay", "Relay socket is down; reconnecting", expect.objectContaining({ attempt: 1 }));
    await Promise.all([a!.close(), b!.close()]);
  });
});

describe("relay requests", () => {
  it("claims a share with the owner secret and the SHA-256 hex of the relay token's decoded bytes", async () => {
    const seen: Seen[] = [];
    const token = Buffer.alloc(32, 7);
    await addRelayShare({
      relayUrl: "https://relay.example", ownerSecret: "owner", shareId: SHARE_ID, relayToken: token.toString("base64url"), fetch: answering(200, { v: "2.0" }, seen),
    });
    const relayTokenHash = createHash("sha256").update(token).digest("hex");
    expect(seen).toEqual([{ url: "https://relay.example/claim", body: { v: "2.0", shareId: SHARE_ID, relayTokenHash }, authorization: "Bearer owner" }]);
    const claimed = addRelayShare({ relayUrl: "https://relay.example", ownerSecret: "owner", shareId: SHARE_ID, relayToken: "AA", fetch: answering(409, { v: "2.0", error: "claimed" }) });
    await expect(claimed).rejects.toMatchObject({ code: "claimed", status: 409 });
  });

  it("names a refusal and a relay of another major", async () => {
    const refused = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(403, { v: "2.0", error: "forbidden" }) });
    await expect(refused).rejects.toMatchObject({ code: "forbidden", status: 403 });
    const newer = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(200, { v: "3.0", ticket: "x", expires: 1 }) });
    await expect(newer).rejects.toBeInstanceOf(RelayRequestError);
    await expect(newer).rejects.toMatchObject({ code: "incompatibleRelay" });
  });

  it.each([
    ["a 503 HTML page", 503, "<html><body>Service Unavailable</body></html>"],
    ["a 502 empty body", 502, ""],
    ["a 200 HTML page", 200, "<html>captive portal</html>"],
  ])("names %s from /ticket a relayDown refusal with the status", async (_name, status, body) => {
    const down: typeof fetch = async () => new Response(body, { status });
    const refused = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: down });
    await expect(refused).rejects.toMatchObject({ code: "relayDown", status });
    await expect(refused).rejects.toThrow(`HTTP ${status}`);
  });

  it("names a 5xx that carries JSON a relayDown refusal and a failed fetch a network error", async () => {
    const failing = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(500, { v: "2.0", error: "internal" }) });
    await expect(failing).rejects.toMatchObject({ code: "relayDown", status: 500 });
    const offline: typeof fetch = async () => { throw new TypeError("fetch failed"); };
    await expect(fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: offline })).rejects.toMatchObject({ code: "network", status: 0 });
  });
});
