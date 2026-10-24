/** Pins the relay watch: a newcomer that cannot use the group's relay brings the whole group to its relay within seconds. */
import { FakeClock, runUntil } from "../peer/fakeNetwork";
import { runFor } from "../transport/relay/fakeRelay";
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
