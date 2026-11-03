/** Pins the withdrawal of a relay from the list: the index change reaches peers over the relay being left, so no edit is lost or split. */
import { addRelay, readRelayList, removeOwnRelay } from "../../../src/collab/relays/index";
import { FakeClock, runUntil } from "../fakeNetwork";
import { runFor } from "./fakeRelay";
import { ONE, openGroupClient, RelayHosts, TWO, type GroupClient } from "./relayGroup";

const LISTING_WAIT_MS = 10_000;
const urlsOf = (client: GroupClient) => readRelayList(client.session.index).map((entry) => entry.url);

describe("withdrawing a relay from the list", () => {
  it("delivers the withdrawal over the relay being left, so the peers follow the owner without a lost edit", async () => {
    const clock = new FakeClock();
    const hosts = new RelayHosts(clock);
    const owner = await openGroupClient(hosts, clock, "Ada", { owner: true, relays: [ONE] });
    const peer = await openGroupClient(hosts, clock, "Grace", { relays: [ONE] });
    try {
      await runFor(clock, 5000);
      expect([owner.selector.current, peer.selector.current]).toEqual([ONE, ONE]);
      owner.text().insert(0, "a");
      await runFor(clock, 5000);

      addRelay(owner.session.index, { url: TWO, addedBy: "Ada" });
      await runFor(clock, LISTING_WAIT_MS);
      expect(urlsOf(peer)).toEqual([ONE, TWO]);

      removeOwnRelay(owner.session.index, ONE, "Ada");
      await runFor(clock, 1000);
      owner.text().insert(1, "b");
      // TRAP: under load virtual time outruns the real WebCrypto work, so convergence is awaited rather than timed.
      await runUntil(clock, () => urlsOf(peer).join() === TWO && peer.text().toString() === "ab", 60_000, 500).catch(() => undefined);

      expect(hosts.relay(ONE).up).toBe(true);
      expect(urlsOf(owner)).toEqual([TWO]);
      expect(urlsOf(peer)).toEqual([TWO]);
      expect(peer.text().toString()).toBe("ab");
      expect([owner.selector.current, peer.selector.current]).toEqual([TWO, TWO]);
    } finally {
      await Promise.all([owner.close(), peer.close()]);
    }
  }, 120_000);
});
