/** Pins that an update whose sealing fails stays pending, is logged as an error and reaches the relay in the next put window. */
import { PUT_INTERVAL_MS } from "../../../src/collab/relays/relayDocPuts";
import { FakeClock } from "../peer/fakeNetwork";
import { FakeRelay, runFor } from "../transport/relay/fakeRelay";
import { openRelayClient } from "../transport/relay/relayClient";

describe("relay put retry", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps the update when sealing fails once, logs an error and puts it in the next window", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const client = await openRelayClient(relay, clock);
    await runFor(clock, 1000);
    const failure = new Error("encrypt failed");
    jest.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(failure);

    client.text().insert(0, "kept");
    await runFor(clock, PUT_INTERVAL_MS + 500);
    expect(relay.counts.put).toBe(0);
    expect(client.logger.error).toHaveBeenCalledTimes(1);
    const [, error, context] = client.logger.error.mock.calls[0]!;
    expect(error).toBe(failure);
    expect(context).toMatchObject({ shareId: expect.any(String), docKey: "main.tex" });

    await runFor(clock, PUT_INTERVAL_MS + 500);
    expect(relay.counts.put).toBe(1);
    expect(client.logger.error).toHaveBeenCalledTimes(1);
    await client.close();
  });
});
