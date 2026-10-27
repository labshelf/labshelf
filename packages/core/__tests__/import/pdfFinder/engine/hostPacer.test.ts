/** Contract of the per-host pacer: spaced starts, a skip after repeated failures, a reset on success. */
import { createPacedFetch } from "../../../../src/import/pdfFinder/hostPacer";

type Answer = () => Response | Promise<Response>;

function recorder(answer: Answer = () => new Response("ok")) {
  const starts: Array<{ url: string; at: number }> = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    starts.push({ url: String(input), at: Date.now() });
    return answer();
  }) as typeof fetch;
  return { starts, fetchFn };
}

describe("pacedFetch spacing", () => {
  it("starts requests to one host at least the gap apart, even when issued together", async () => {
    const { starts, fetchFn } = recorder();
    const paced = createPacedFetch(fetchFn, { hostGapMs: 100, hostMaxFailures: 5 });
    await Promise.all([1, 2, 3].map((i) => paced(`https://a.example/${i}`)));
    const gaps = starts.slice(1).map((s, i) => s.at - starts[i]!.at);
    expect(starts.map((s) => s.url)).toEqual(["https://a.example/1", "https://a.example/2", "https://a.example/3"]);
    expect(gaps.every((g) => g >= 90)).toBe(true);
  });

  it("does not delay a request to another host", async () => {
    const { starts, fetchFn } = recorder();
    const paced = createPacedFetch(fetchFn, { hostGapMs: 300, hostMaxFailures: 5 });
    const began = Date.now();
    await Promise.all([paced("https://a.example/1"), paced("https://b.example/1")]);
    expect(starts.every((s) => s.at - began < 100)).toBe(true);
  });

  it("stops waiting for its slot when the request is cancelled", async () => {
    const { starts, fetchFn } = recorder();
    const paced = createPacedFetch(fetchFn, { hostGapMs: 500, hostMaxFailures: 5 });
    await paced("https://a.example/1");
    const stop = new AbortController();
    const second = paced("https://a.example/2", { signal: stop.signal });
    stop.abort(new DOMException("stop", "AbortError"));
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(starts).toHaveLength(1);
  });
});

describe("pacedFetch failures", () => {
  const limits = { hostGapMs: 0, hostMaxFailures: 3 };

  it("skips a host after the maximum consecutive failed responses, for the rest of the run", async () => {
    const { starts, fetchFn } = recorder(() => new Response("", { status: 503 }));
    const paced = createPacedFetch(fetchFn, limits);
    for (let i = 0; i < 3; i++) expect((await paced("https://a.example/x")).status).toBe(503);
    await expect(paced("https://a.example/y")).rejects.toThrow(/a\.example skipped after 3 failed requests/);
    await expect(paced("https://a.example/z")).rejects.toThrow(/skipped/);
    expect(starts).toHaveLength(3);
  });

  it("keeps asking other hosts", async () => {
    const { fetchFn } = recorder(() => new Response("", { status: 500 }));
    const paced = createPacedFetch(fetchFn, limits);
    for (let i = 0; i < 3; i++) await paced("https://a.example/x");
    expect((await paced("https://b.example/x")).status).toBe(500);
  });

  it("counts a thrown network error as a failure", async () => {
    const { fetchFn } = recorder(() => { throw new TypeError("Failed to fetch"); });
    const paced = createPacedFetch(fetchFn, limits);
    for (let i = 0; i < 3; i++) await expect(paced("https://a.example/x")).rejects.toThrow("Failed to fetch");
    await expect(paced("https://a.example/x")).rejects.toThrow(/skipped/);
  });

  it("does not count a request the run cancelled", async () => {
    const { fetchFn } = recorder(() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const paced = createPacedFetch(fetchFn, limits);
    for (let i = 0; i < 6; i++) await expect(paced("https://a.example/x")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("resets the count on a success", async () => {
    let status = 500;
    const { starts, fetchFn } = recorder(() => new Response("", { status }));
    const paced = createPacedFetch(fetchFn, limits);
    await paced("https://a.example/x");
    await paced("https://a.example/x");
    status = 200;
    await paced("https://a.example/x");
    status = 500;
    await paced("https://a.example/x");
    await paced("https://a.example/x");
    expect((await paced("https://a.example/x")).status).toBe(500);
    expect(starts).toHaveLength(6);
    await expect(paced("https://a.example/x")).rejects.toThrow(/skipped/);
  });
});
