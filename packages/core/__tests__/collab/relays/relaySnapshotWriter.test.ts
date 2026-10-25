/** Pins that of the clients connected to one relay only the one with the lowest awareness id writes the snapshot at 500 updates. */
import { SNAPSHOT_AFTER_PUTS } from "../../../src/collab/relays/relaySync";
import { FakeClock } from "../peer/fakeNetwork";
import { FakeRelay, runFor } from "../transport/relay/fakeRelay";
import { openRelayClient, type RelayClient } from "../transport/relay/relayClient";

describe("relay snapshots", () => {
  it("sends one snapshot when three clients reach 500 updates, and logs no refusal", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const clients: RelayClient[] = await Promise.all([1, 2, 3].map(() => openRelayClient(relay, clock)));
    clients.forEach((client, i) => client.presence.setLocal({ name: `c${i}`, colour: "#000000", file: null, anchor: null, head: null }));
    await runFor(clock, 1000);
    for (let i = 0; i < SNAPSHOT_AFTER_PUTS + 5; i += 1) {
      const client = clients[i % clients.length]!;
      client.text().insert(client.text().length, "x");
      await client.relaySync.flush();
      await runFor(clock, 100);
    }
    await runFor(clock, 2000);

    expect(relay.counts.snapshot).toBe(1);
    expect(relay.snapshots.size).toBe(1);
    expect(clients.map((client) => client.text().length)).toEqual([SNAPSHOT_AFTER_PUTS + 5, SNAPSHOT_AFTER_PUTS + 5, SNAPSHOT_AFTER_PUTS + 5]);
    await Promise.all(clients.map((client) => client.close()));
  }, 120_000);

  it("logs a stale snapshot refusal as information, not as a warning", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    relay.staleSnapshots = true;
    const writer = await openRelayClient(relay, clock);
    await runFor(clock, 1000);
    for (let i = 0; i < SNAPSHOT_AFTER_PUTS; i += 1) {
      writer.text().insert(0, "x");
      await writer.relaySync.flush();
      await runFor(clock, 100);
    }
    await runFor(clock, 1000);
    expect(relay.counts.snapshot).toBe(1);
    const levels = writer.logger.log.mock.calls.map(([level, , message]) => `${level} ${message}`);
    expect(levels.some((line) => line.startsWith("INFO") && /stale/i.test(line))).toBe(true);
    expect(levels.some((line) => line.startsWith("WARN") && /refused a request/.test(line))).toBe(false);
    await writer.close();
  }, 120_000);
});
