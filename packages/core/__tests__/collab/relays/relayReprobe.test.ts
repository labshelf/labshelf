/** Pins the relay re-probe: a relay that answers with Cloudflare's 1027 page loses the whole group at its next probe. */
import { FakeClock, runUntil } from "../peer/fakeNetwork";
import { runFor } from "../transport/relay/fakeRelay";
import { ONE, openGroupClient, RelayHosts, TWO, type GroupClient } from "./relayGroup";

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
