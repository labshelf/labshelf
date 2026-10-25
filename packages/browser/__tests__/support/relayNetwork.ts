// Runs the core tests' in-process relays on a virtual clock that real timers drive, so browser pages share projects through them.
import { encodeRelayBody, type RelayAccount, type RelayNetwork } from "@labshelf/core";
import { ONE, RelayHosts } from "../../../core/__tests__/collab/relays/relayGroup";
import { FakeClock } from "../../../core/__tests__/collab/peer/fakeNetwork";

export interface RelayNet {
  network: RelayNetwork;
  /** The owner's account on the in-process relay. */
  account: RelayAccount;
  /** Answers the owner's claim of a share, which the in-process relays do not check. */
  claimFetch: typeof fetch;
  /** Requests every page made to the relays so far. */
  requests(): number;
  stop(): void;
}

export function relayNet(): RelayNet {
  const clock = new FakeClock();
  const hosts = new RelayHosts(clock);
  // Virtual time runs four times faster than real time, so relay timers do not slow the tests down.
  const pump = setInterval(() => clock.advance(20), 5);
  return {
    network: { scheduler: clock, fetch: hosts.fetchFor(new Set()), socketFactory: hosts.socketFactoryFor(new Set()) },
    account: { relayUrl: ONE, ownerSecret: "owner-secret" } as RelayAccount,
    claimFetch: async () => new Response(encodeRelayBody({}), { status: 200 }),
    requests: () => [...hosts.requests.values()].reduce((sum, count) => sum + count, 0),
    stop: () => clearInterval(pump),
  };
}
