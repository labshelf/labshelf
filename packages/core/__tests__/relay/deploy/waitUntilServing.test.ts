/** Pins that the wait polls /version with growing delays on an injected clock and gives up at the timeout. */
import { waitUntilServing, type RelayClock } from "../../../src/relay/index";
import { recordingLogger } from "./fakeCloudflare";

function fakeClock(): RelayClock & { sleeps: number[] } {
  let time = 0;
  const sleeps: number[] = [];
  return { sleeps, now: () => time, async sleep(ms) { sleeps.push(ms); time += ms; } };
}

describe("waitUntilServing", () => {
  it("retries through TLS failures, backing off, until /version answers", async () => {
    const clock = fakeClock();
    let calls = 0;
    const fetchStub = (async () => {
      calls += 1;
      if (calls < 5) { throw new TypeError("TLS handshake failure"); }
      return new Response(JSON.stringify({ v: "1.0", worker: "1.0.0" }), { status: 200 });
    }) as typeof fetch;
    await waitUntilServing({ relayUrl: "https://relay.lab.workers.dev", fetch: fetchStub, logger: recordingLogger(), clock });
    expect(calls).toBe(5);
    expect(clock.sleeps).toEqual([5000, 7500, 11250, 15000]);
  });

  it("gives up with a readable error after the timeout", async () => {
    const clock = fakeClock();
    const fetchStub = (async () => { throw new TypeError("TLS handshake failure"); }) as typeof fetch;
    await expect(waitUntilServing({ relayUrl: "https://r.w.dev", fetch: fetchStub, logger: recordingLogger(), clock, timeoutMs: 30_000 }))
      .rejects.toThrow(/did not answer within 30 s/);
    expect(clock.now()).toBeLessThanOrEqual(30_000);
  });
});
