/** Pins relay selection: one relay for the whole group, failover on limits or repeated failures, and return after the hold. */
import * as Y from "yjs";
import type { RelayReport } from "../../../src/collab/sync/index";
import {
  addRelay, createRelaySelector, RELAY_DOWN_HOLD_MS, type RelayPresence, type RelaySelector,
} from "../../../src/collab/relays/index";
import { FakeClock } from "../sync/fakeNetwork";
import { fakeLogger } from "../sync/testSession";
import { runFor } from "../transport/relay/fakeRelay";

const ONE = "https://one.example.workers.dev";
const TWO = "https://two.example.workers.dev";
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
    probe: async (url) => { probes.push(url); return reachable.has(url); },
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

  it("checks a relay that did not answer again, and holds it down after three silent probes", async () => {
    const reachable = new Set([TWO]);
    const g = group([ONE, TWO], ["a"], reachable);
    await runFor(g.clock, 1000);
    expect(g.current()).toEqual([TWO]);
    await runFor(g.clock, 130_000, 1000);
    expect(g.probes.filter((url) => url === ONE)).toHaveLength(3);
    expect(g.bus.reports.get("a")!.relaysDown[ONE]).toBeGreaterThan(g.clock.now());
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
      index, inviteRelays: [TWO], presence: new PresenceBus(clock).member("a"), clock, logger: fakeLogger(), probe: async () => true,
    });
    await runFor(clock, 1000);
    expect(selector.current).toBe(TWO);
    addRelay(index, { url: ONE, addedBy: "Ada" });
    await runFor(clock, 1000);
    expect(selector.current).toBe(ONE);
    selector.close();
  });
});
