/** Pins the watch's failure rule: a relay the watcher cannot reach is held down after three failures in a row and not watched again. */
import { RELAY_DOWN_HOLD_MS } from "../../../src/collab/relays/index";
import { RELAY_PATH } from "../../../src/relay/http/index";
import { FakeClock } from "../peer/fakeNetwork";
import { runFor } from "../transport/relay/fakeRelay";
import { ONE, openGroupClient, RelayHosts, TWO } from "./relayGroup";

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
