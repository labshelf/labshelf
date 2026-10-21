/** Pins relay outages: a mark holds a relay down only while another one is up, so a client whose relays are all down keeps retrying them. */
import { RELAY_DOWN_HOLD_MS } from "../../../src/collab/relays/index";
import { FakeClock, runUntil } from "../sync/fakeNetwork";
import { runFor } from "../transport/relay/fakeRelay";
import { ONE, openGroupClient, RelayHosts, TWO } from "./relayGroup";

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
