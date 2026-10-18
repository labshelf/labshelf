/** Pins the relay probe: a compatible /version answers, another major or 3 s of silence does not. */
import { PROBE_TIMEOUT_MS, relayProbe } from "../../../src/collab/relays/index";
import { FakeClock } from "../sync/fakeNetwork";
import { fakeLogger } from "../sync/testSession";

const URL_ONE = "https://one.example.workers.dev";
const answer = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

describe("relay probe", () => {
  it("accepts a Worker of the same major and refuses another major", async () => {
    const clock = new FakeClock();
    const same = relayProbe({ logger: fakeLogger(), scheduler: clock, fetch: answer({ v: "1.4", worker: "1.4.2" }) });
    const other = relayProbe({ logger: fakeLogger(), scheduler: clock, fetch: answer({ v: "2.0", worker: "2.0.0" }) });
    expect(await same(URL_ONE)).toBe(true);
    expect(await other(URL_ONE)).toBe(false);
  });

  it("gives up on a relay that does not answer within the timeout", async () => {
    const clock = new FakeClock();
    const silent = relayProbe({ logger: fakeLogger(), scheduler: clock, fetch: () => new Promise<Response>(() => {}) });
    const result = silent(URL_ONE);
    clock.advance(PROBE_TIMEOUT_MS);
    expect(await result).toBe(false);
  });
});
