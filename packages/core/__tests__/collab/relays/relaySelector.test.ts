/** Pins relay selection: one relay for the whole group, failover on limits or repeated failures, outages, re-probes, and return after the hold. */
import * as Y from "yjs";
import type { RelayReport } from "../../../src/collab/index";
import {
  addRelay, createRelaySelector, RELAY_DOWN_HOLD_MS, type RelayPresence, type RelaySelector,
} from "../../../src/collab/relays/index";
import { FakeClock, runUntil } from "../fakeNetwork";
import { fakeLogger } from "../testSession";
import { runFor } from "./fakeRelay";
import { ONE, openGroupClient, RelayHosts, TWO, typeFor, type GroupClient } from "./relayGroup";

const THREE = "https://three.example.workers.dev";
const PRESENCE_LATENCY_MS = 50;

/** Delivers each member's relay report to the others after a short delay, like awareness over a mesh. */
class PresenceBus {
  readonly reports = new Map<string, RelayReport>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(private clock: FakeClock) {}

  member(id: string): RelayPresence {
    this.listeners.set(id, new Set());
    return {
      peers: () => [...this.reports].filter(([other]) => other !== id).map(([, report]) => report),
      publish: (report) => {
        this.clock.after(PRESENCE_LATENCY_MS, () => {
          this.reports.set(id, report);
          this.listeners.forEach((set, other) => { if (other !== id) { set.forEach((fn) => fn()); } });
        });
      },
      onPeersChange: (fn) => { this.listeners.get(id)!.add(fn); return () => this.listeners.get(id)!.delete(fn); },
      watch: () => {},
    };
  }
}

function group(urls: string[], members: string[], reachable: Set<string>) {
  const clock = new FakeClock();
  const bus = new PresenceBus(clock);
  const index = new Y.Doc();
  urls.forEach((url) => addRelay(index, { url, addedBy: "Ada" }));
  const probes: string[] = [];
  const selectors = new Map<string, RelaySelector>(members.map((id) => [id, createRelaySelector({
    index, presence: bus.member(id), clock, logger: fakeLogger(),
    probe: async (url) => { probes.push(url); return reachable.has(url) ? "ok" : "error"; },
  })]));
  const current = () => [...selectors.values()].map((selector) => selector.current);
  return { clock, bus, index, selectors, current, probes, close: () => selectors.forEach((s) => s.close()) };
}

describe("relay selector", () => {
  it("puts every client on the first relay in list order that answers", async () => {
    const g = group([ONE, TWO, THREE], ["a", "b", "c"], new Set([TWO, THREE]));
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([TWO, TWO, TWO]);
    expect([...g.bus.reports.values()].map((report) => report.relay)).toEqual([TWO, TWO, TWO]);
    g.close();
  });

  it("moves the whole group off a relay that refused for limits, and back once the hold ends", async () => {
    const g = group([ONE, TWO], ["a", "b", "c"], new Set([ONE, TWO]));
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([ONE, ONE, ONE]);
    g.selectors.get("a")!.reportFailure(ONE, "limit");
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([TWO, TWO, TWO]);
    for (const report of g.bus.reports.values()) { expect(report.relaysDown[ONE]).toBeGreaterThan(g.clock.now()); }

    await runFor(g.clock, RELAY_DOWN_HOLD_MS - 5000, 1000);
    expect(g.current()).toEqual([TWO, TWO, TWO]);
    await runFor(g.clock, 10_000, 1000);
    expect(g.current()).toEqual([ONE, ONE, ONE]);
    expect([...g.bus.reports.values()].map((report) => report.relaysDown)).toEqual([{}, {}, {}]);
    g.close();
  });

  it("holds a relay down after three failures in a row, and an open socket resets the count", async () => {
    const g = group([ONE, TWO], ["a"], new Set([ONE, TWO]));
    const a = g.selectors.get("a")!;
    await runFor(g.clock, 1000);
    a.reportFailure(ONE, "error");
    a.reportFailure(ONE, "error");
    a.reportConnected(ONE);
    a.reportFailure(ONE, "error");
    a.reportFailure(ONE, "error");
    await runFor(g.clock, 1000);
    expect(a.current).toBe(ONE);
    a.reportFailure(ONE, "error");
    await runFor(g.clock, 1000);
    expect(a.current).toBe(TWO);
    g.close();
  });

  it("retries a relay that did not answer after 20 s, holds it down after three silent probes and checks it every minute", async () => {
    const reachable = new Set([TWO]);
    const g = group([ONE, TWO], ["a"], reachable);
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([TWO]);
    await runFor(g.clock, 45_000, 1000);
    expect(g.probes.filter((url) => url === ONE)).toHaveLength(3);
    expect(g.bus.reports.get("a")!.relaysDown[ONE]).toBeGreaterThan(g.clock.now());
    await runFor(g.clock, 60_000, 1000);
    expect(g.probes.filter((url) => url === ONE)).toHaveLength(4);
    reachable.add(ONE);
    await runFor(g.clock, 61_000, 1000);
    expect(g.current()).toEqual([ONE]);
    expect(g.bus.reports.get("a")!.relaysDown).toEqual({});
    g.close();
  });

  it("keeps a relay after one failed re-probe and leaves it after three", async () => {
    const reachable = new Set([ONE, TWO]);
    const g = group([ONE, TWO], ["a", "b"], reachable);
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([ONE, ONE]);
    reachable.delete(ONE);
    await runFor(g.clock, 61_000, 1000);
    expect(g.current()).toEqual([ONE, ONE]);
    await runFor(g.clock, 45_000, 1000);
    expect(g.current()).toEqual([TWO, TWO]);
    g.close();
  });

  it("caps a peer's hold at one hour and leaves a relay removed from the list", async () => {
    const g = group([ONE, TWO], ["a", "b"], new Set([ONE, TWO]));
    await runFor(g.clock, 1000);
    g.bus.member("z").publish({ relay: TWO, relaysDown: { [ONE]: g.clock.now() + 10 * RELAY_DOWN_HOLD_MS } });
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([TWO, TWO]);
    g.bus.reports.delete("z");
    await runFor(g.clock, RELAY_DOWN_HOLD_MS + 1000, 1000);
    expect(g.current()).toEqual([ONE, ONE]);

    const relays = g.index.getArray("relays");
    relays.delete(0, 1);
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([TWO, TWO]);
    g.close();
  });

  it("uses the invite's relays until the index lists any", async () => {
    const clock = new FakeClock();
    const index = new Y.Doc();
    const selector = createRelaySelector({
      index, inviteRelays: [TWO], presence: new PresenceBus(clock).member("a"), clock, logger: fakeLogger(), probe: async () => "ok",
    });
    await runFor(clock, 1000);
    expect(selector.current).toBe(TWO);
    addRelay(index, { url: ONE, addedBy: "Ada" });
    await runFor(clock, 1000);
    expect(selector.current).toBe(ONE);
    selector.close();
  });
});

const tickets = (hosts: RelayHosts) => [ONE, TWO].reduce((sum, url) => sum + (hosts.requests.get(`${url}/ticket`) ?? 0), 0);

/** Drops the relay's sockets and refuses every later request and socket, as during an outage. */
function takeDown(hosts: RelayHosts, url: string): void {
  hosts.set(url, "refuseNew");
  hosts.relay(url).dropAll();
}

describe("relay outage", () => {
  it("keeps requesting tickets from a single relay after three failures and resumes once it is back", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const a = await openGroupClient(hosts, clock, "Ada", { owner: true, relays: [ONE] });
    await runFor(clock, 5000);
    expect(a.selector.current).toBe(ONE);
    takeDown(hosts, ONE);
    await runFor(clock, 5 * 60_000, 1000);
    a.text().insert(0, "x");
    hosts.set(ONE, "up");
    const before = tickets(hosts);
    await runFor(clock, 61_000, 1000);
    expect(tickets(hosts)).toBeGreaterThan(before);
    expect(a.selector.current).toBe(ONE);
    await runFor(clock, 5000);
    const b = await openGroupClient(hosts, clock, "Grace", { relays: [ONE] });
    expect(await runUntil(clock, () => b.text().toString() === "x", 30_000, 500)).toBe(true);
    await Promise.all([a, b].map((client) => client.close()));
  }, 60_000);

  it("holds a relay down for the hour while another listed relay is up", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const a = await openGroupClient(hosts, clock, "Ada", { owner: true });
    await runFor(clock, 5000);
    takeDown(hosts, ONE);
    await runFor(clock, 30_000, 1000);
    expect(a.selector.current).toBe(TWO);
    hosts.set(ONE, "up");
    const before = hosts.requests.get(`${ONE}/ticket`);
    await runFor(clock, RELAY_DOWN_HOLD_MS - 120_000, 1000);
    expect(a.selector.current).toBe(TWO);
    expect(hosts.requests.get(`${ONE}/ticket`)).toBe(before);
    await runFor(clock, 180_000, 1000);
    expect(a.selector.current).toBe(ONE);
    await a.close();
  }, 120_000);

  it("retries while every relay is down, at most 60 s apart, and resumes on the first one back", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const a = await openGroupClient(hosts, clock, "Ada", { owner: true });
    await runFor(clock, 5000);
    takeDown(hosts, ONE);
    takeDown(hosts, TWO);
    await runFor(clock, 5 * 60_000, 1000);
    const gaps: number[] = [];
    let last = { count: tickets(hosts), at: clock.now() };
    for (let step = 0; step < 300; step += 1) {
      await runFor(clock, 1000, 1000);
      if (tickets(hosts) > last.count) { gaps.push(clock.now() - last.at); last = { count: tickets(hosts), at: clock.now() }; }
    }
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...gaps, clock.now() - last.at)).toBeLessThanOrEqual(61_000);
    expect(gaps.length).toBeLessThanOrEqual(12);
    hosts.set(TWO, "up");
    await runFor(clock, 125_000, 1000);
    expect(a.selector.current).toBe(TWO);
    await a.close();
  }, 120_000);
});

describe("relay failover", () => {
  it("moves every client to the next relay on a 429 without losing an edit, and back after the hold", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const a = await openGroupClient(hosts, clock, "Ada", { owner: true });
    const b = await openGroupClient(hosts, clock, "Grace");
    await runFor(clock, 5000);
    expect([a.selector.current, b.selector.current]).toEqual([ONE, ONE]);
    typeFor(clock, a, "a", 10);
    typeFor(clock, b, "b", 10);
    await runFor(clock, 5000);

    typeFor(clock, a, "A", 40);
    typeFor(clock, b, "B", 40);
    await runFor(clock, 1500);
    hosts.set(ONE, "limit");
    await runFor(clock, 30_000);
    expect([a.selector.current, b.selector.current]).toEqual([TWO, TWO]);
    const text = a.text().toString();
    expect(b.text().toString()).toBe(text);
    expect([...text].sort().join("")).toBe(`${"A".repeat(40)}${"B".repeat(40)}${"a".repeat(10)}${"b".repeat(10)}`);

    await a.close();
    await b.close();
    const late = await openGroupClient(hosts, clock, "Ken");
    await runFor(clock, 5000);
    expect(late.selector.current).toBe(TWO);
    expect(late.session.peers).toEqual([]);
    expect(late.text().toString()).toBe(text);

    hosts.set(ONE, "up");
    late.text().insert(0, "x");
    // The late client held ONE down from its own probe, so its next probe that ONE answers ends the hold.
    await runFor(clock, 61_000, 1000);
    expect(late.selector.current).toBe(ONE);
    await runFor(clock, 5000);
    await late.close();
    const back = await openGroupClient(hosts, clock, "Barbara");
    await runFor(clock, 5000);
    expect(back.selector.current).toBe(ONE);
    expect(back.text().toString()).toBe(`x${text}`);
    await back.close();
  }, 120_000);

  it("gives a relay it returns to the edits made while the group was on another one, even with stored cursors", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const a = await openGroupClient(hosts, clock, "Ada", { owner: true, cursors: new Map() });
    await runFor(clock, 5000);
    a.text().insert(0, "1");
    await runFor(clock, 5000);
    hosts.set(ONE, "limit");
    await runFor(clock, 10_000);
    expect(a.selector.current).toBe(TWO);
    a.text().insert(1, "2");
    await runFor(clock, 5000);
    hosts.set(ONE, "up");
    // TRAP: steps stay under the probe's 3 s timeout, or the timeout fires in the same advance as the relay's answer.
    await runFor(clock, RELAY_DOWN_HOLD_MS, 1000);
    expect(a.selector.current).toBe(ONE);
    await runFor(clock, 5000);
    await a.close();

    hosts.set(TWO, "limit");
    const late = await openGroupClient(hosts, clock, "Ken");
    await runFor(clock, 5000);
    expect(late.selector.current).toBe(ONE);
    expect(late.text().toString()).toBe("12");
    await late.close();
  }, 60_000);
});

const sorted = (client: GroupClient) => [...client.text().toString()].sort().join("");

describe("relay re-probe", () => {
  it("moves everyone off a relay at its next probe once it answers with Cloudflare's 1027 page", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const a = await openGroupClient(hosts, clock, "Ada", { owner: true });
    const b = await openGroupClient(hosts, clock, "Grace");
    await runFor(clock, 5000);
    hosts.set(ONE, "limitPage");
    await runFor(clock, 50_000, 500);
    expect([a.selector.current, b.selector.current]).toEqual([ONE, ONE]);
    await runFor(clock, 10_000, 500);
    expect([a.selector.current, b.selector.current]).toEqual([TWO, TWO]);

    a.text().insert(0, "a");
    b.text().insert(0, "b");
    // TRAP: under load virtual time outruns the real WebCrypto work, so convergence is awaited rather than timed.
    await runUntil(clock, () => sorted(a) === "ab" && b.text().toString() === a.text().toString(), 60_000, 500);
    expect(sorted(a)).toBe("ab");
    expect(b.text().toString()).toBe(a.text().toString());
    await Promise.all([a, b].map((client) => client.close()));
  }, 60_000);
});
