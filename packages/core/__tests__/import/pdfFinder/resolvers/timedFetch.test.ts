/** Contract of the bounded lookup every resolver uses: an 8 s deadline and exactly one WARN per failed lookup. */
import { lookupJson } from "../../../../src/import/pdfFinder/resolvers/timedFetch";
import { json, makeFindingHarness } from "../../../support/pdfFindingHarness";

describe("lookupJson", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the parsed body", async () => {
    const h = makeFindingHarness();
    h.routes["https://api.example/x"] = () => json({ a: 1 });
    expect(await lookupJson(h.env, "https://api.example/x")).toEqual({ a: 1 });
    expect(h.logs).toEqual([]);
  });

  it("warns once with the URL and status on an HTTP error", async () => {
    const h = makeFindingHarness();
    h.routes["https://api.example/x"] = () => new Response("", { status: 429 });
    expect(await lookupJson(h.env, "https://api.example/x")).toBeUndefined();
    expect(h.logs).toEqual([{ level: "WARN", module: "pdfFinding", message: "lookup failed", context: { url: "https://api.example/x", status: 429 } }]);
  });

  it("warns once on a body that is not JSON", async () => {
    const h = makeFindingHarness();
    h.routes["https://api.example/x"] = () => new Response("<html>");
    expect(await lookupJson(h.env, "https://api.example/x")).toBeUndefined();
    expect(h.logs).toHaveLength(1);
  });

  it("gives up after 8 s", async () => {
    const deadline = new AbortController();
    const timeout = jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const h = makeFindingHarness();
    const env = { ...h.env, fetch: ((_u: unknown, init: { signal: AbortSignal }) => new Promise<Response>((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch };
    const pending = lookupJson(env, "https://slow.example/x");
    expect(timeout).toHaveBeenCalledWith(8_000);
    deadline.abort();
    expect(await pending).toBeUndefined();
    expect(h.logs).toHaveLength(1);
  });
});
