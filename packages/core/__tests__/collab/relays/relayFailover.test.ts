/** Pins failover on real sessions over two in-process relays: the group moves together on a 429 and no edit is lost. */
import { RELAY_DOWN_HOLD_MS } from "../../../src/collab/relays/index";
import { FakeClock } from "../sync/fakeNetwork";
import { runFor } from "../transport/relay/fakeRelay";
import { ONE, openGroupClient, RelayHosts, TWO, typeFor } from "./relayGroup";

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
