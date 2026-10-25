/** Pins the relay probe: a compatible /version is ok, a 429 or 1027 page is a limit, another major or 3 s of silence is an error. */
import { PROBE_TIMEOUT_MS, createRelayProbe } from "../../../src/collab/relays/index";
import { FakeClock } from "../peer/fakeNetwork";
import { fakeLogger } from "../doc/testSession";

const URL_ONE = "https://one.example.workers.dev";
const answer = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

describe("relay probe", () => {
  it("accepts a Worker of the same major and refuses another major", async () => {
    const clock = new FakeClock();
    const same = createRelayProbe({ logger: fakeLogger(), scheduler: clock, fetch: answer({ v: "2.4", worker: "2.4.2" }) });
    const other = createRelayProbe({ logger: fakeLogger(), scheduler: clock, fetch: answer({ v: "3.0", worker: "3.0.0" }) });
    expect(await same(URL_ONE)).toBe("ok");
    expect(await other(URL_ONE)).toBe("error");
  });

  it("gives up on a relay that does not answer within the timeout", async () => {
    const clock = new FakeClock();
    const silent = createRelayProbe({ logger: fakeLogger(), scheduler: clock, fetch: () => new Promise<Response>(() => {}) });
    const result = silent(URL_ONE);
    clock.advance(PROBE_TIMEOUT_MS);
    expect(await result).toBe("error");
  });

  it("calls a 429 or Cloudflare's 1027 page a limit refusal", async () => {
    const clock = new FakeClock();
    const page = (status: number) => createRelayProbe({
      logger: fakeLogger(), scheduler: clock, fetch: async () => new Response("<html>error code: 1027</html>", { status }),
    });
    expect(await page(429)(URL_ONE)).toBe("limit");
    expect(await page(503)(URL_ONE)).toBe("limit");
  });
});
