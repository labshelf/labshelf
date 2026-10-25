/** Contract of the download stage: rank beats arrival within the hold, concurrency and time limits hold. */
import { downloadBest, type Candidate, type EngineLimits } from "../../../../src/import/pdfFinder/engine/index";
import type { PdfVersion } from "@labshelf/core";
import type { PdfAttempt } from "../../../../src/import/pdfFinder/pdfResolver";
import { pdf, makeContext, html } from "../../../support/pdfFindingHarness";
import { candidatesOf, FAST_LIMITS, makeSlowNetwork } from "../../../support/slowNetwork";

const A = "https://a.example/p.pdf";
const B = "https://b.example/p.pdf";
const C = "https://c.example/p.pdf";

async function run(urls: string[], net: ReturnType<typeof makeSlowNetwork>, limits: Partial<EngineLimits> = {}, ctx = makeContext()) {
  const attempts: PdfAttempt[] = [];
  const started = Date.now();
  const found = await downloadBest(ctx, candidatesOf(...urls), { opts: {}, env: net.env, limits: { ...FAST_LIMITS, ...limits } }, attempts);
  return { found, attempts, elapsed: Date.now() - started };
}

describe("downloadBest ordering", () => {
  it("keeps the better-ranked PDF when a later-ranked one arrives first, within the hold", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 80, res: pdf };
    net.routes[B] = { res: pdf };
    const got = await run([A, B], net, { holdMs: 600 });
    expect(got.found?.url).toBe(A);
    expect(got.attempts.map((a) => [a.url, a.outcome])).toEqual([[A, "pdf"], [B, "pdf"]]);
  });

  it("settles on the earlier PDF once the hold expires, and leaves the slow better-ranked download out of the attempts", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 1_500, res: pdf };
    net.routes[B] = { res: pdf };
    const got = await run([A, B], net, { holdMs: 80 });
    expect(got.found?.url).toBe(B);
    expect(got.attempts.map((a) => a.url)).toEqual([B]);
    expect(got.elapsed).toBeLessThan(700);
    expect(net.cancelled).toContain(A);
  });

  it("returns at once when the best-ranked candidate downloads first", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { res: pdf };
    net.routes[B] = { ms: 1_500, res: pdf };
    const got = await run([A, B], net, { holdMs: 600 });
    expect(got.found?.url).toBe(A);
    expect(got.elapsed).toBeLessThan(500);
    expect(got.attempts.map((a) => a.url)).toEqual([A]);
  });

  it("labels the winner with whoever proposed it and records failed attempts in rank order", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 60, res: () => html("<html>nothing</html>") };
    net.routes[B] = { res: pdf };
    const got = await run([A, B, C], net, { holdMs: 300 });
    expect(got.found).toMatchObject({ url: B, source: "s:b.example" });
    expect(got.attempts[0]).toMatchObject({ url: A, source: "s:a.example", outcome: "html", status: 200 });
  });

  it("returns nothing, with every failure recorded, when no candidate is a PDF", async () => {
    const net = makeSlowNetwork();
    const got = await run([A, B], net);
    expect(got.found).toBeUndefined();
    expect(got.attempts.map((a) => [a.url, a.outcome, a.status])).toEqual([[A, "error", 404], [B, "error", 404]]);
  });

  it("sends the landing URL as Referer", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { res: pdf };
    await run([A], net, {}, makeContext({ landingUrl: "https://publisher.example/article" }));
    expect(net.calls[0]?.referer).toBe("https://publisher.example/article");
  });
});

describe("downloadBest versions", () => {
  async function* versioned(...entries: Array<[string, PdfVersion | undefined]>): AsyncGenerator<Candidate, void, undefined> {
    for (const [url, version] of entries) yield { url, source: `s:${new URL(url).host}`, ...(version ? { version } : {}) };
  }

  async function runVersioned(entries: Array<[string, PdfVersion | undefined]>, net: ReturnType<typeof makeSlowNetwork>, holdMs = 600) {
    const attempts: PdfAttempt[] = [];
    const found = await downloadBest(makeContext(), versioned(...entries), { opts: {}, env: net.env, limits: { ...FAST_LIMITS, holdMs } }, attempts);
    return { found, attempts };
  }

  it("a published candidate outranks a preprint ranked earlier that finishes first", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { res: pdf };
    net.routes[B] = { ms: 80, res: pdf };
    const { found, attempts } = await runVersioned([[A, "preprint"], [B, "published"]], net);
    expect(found).toMatchObject({ url: B, source: "s:b.example", version: "published" });
    expect(attempts.map((a) => a.url)).toEqual([A, B]);
  });

  it("an untagged PDF that finishes first outranks a preprint ranked earlier, and the result carries no version", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 80, res: pdf };
    net.routes[B] = { res: pdf };
    const { found } = await runVersioned([[A, "preprint"], [B, undefined]], net);
    expect(found?.url).toBe(B);
    expect(found).not.toHaveProperty("version");
  });

  it("a preprint does not wait for an untagged download ranked below it", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { res: pdf };
    net.routes[B] = { ms: 300, res: pdf };
    const started = Date.now();
    const { found } = await runVersioned([[A, "preprint"], [B, undefined]], net, 600);
    expect(found).toMatchObject({ url: A, version: "preprint" });
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("an accepted candidate outranks a preprint and yields to a published one", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { res: pdf };
    net.routes[B] = { ms: 40, res: pdf };
    net.routes[C] = { ms: 80, res: pdf };
    expect((await runVersioned([[A, "preprint"], [B, "accepted"], [C, "published"]], net)).found).toMatchObject({ url: C, version: "published" });
    expect((await runVersioned([[A, "preprint"], [B, "accepted"]], net)).found).toMatchObject({ url: B, version: "accepted" });
  });

  it("falls back to the rank order between equal versions", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 80, res: pdf };
    net.routes[B] = { res: pdf };
    expect((await runVersioned([[A, "published"], [B, "published"]], net)).found?.url).toBe(A);
  });

  it("a preprint wins when it is the only PDF", async () => {
    const net = makeSlowNetwork();
    net.routes[B] = { res: pdf };
    const { found } = await runVersioned([[A, "published"], [B, "preprint"]], net);
    expect(found).toMatchObject({ url: B, version: "preprint" });
  });

  it("does not wait for a worse version still downloading", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { res: pdf };
    net.routes[B] = { ms: 1_500, res: pdf };
    const started = Date.now();
    const { found } = await runVersioned([[A, "published"], [B, "preprint"]], net);
    expect(found?.url).toBe(A);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("downloadBest limits", () => {
  it.each([1, 2, 3])("never has more than %i downloads in flight", async (concurrency) => {
    const net = makeSlowNetwork();
    const urls = Array.from({ length: 7 }, (_, i) => `https://h${i}.example/p.pdf`);
    for (const u of urls) net.routes[u] = { ms: 40, res: () => html("x") };
    await run(urls, net, { concurrency });
    expect(net.calls).toHaveLength(7);
    expect(net.maxInFlight()).toBe(concurrency);
  });

  it("gives up at the total limit, warns, and records nothing for the unfinished download", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 5_000, res: pdf };
    const got = await run([A], net, { totalMs: 100 });
    expect(got.found).toBeUndefined();
    expect(got.attempts).toEqual([]);
    expect(got.elapsed).toBeLessThan(1_000);
    expect(net.logs.filter((l) => l.message === "download stage reached its time limit")).toEqual([
      expect.objectContaining({ level: "WARN", context: { totalMs: 100 } }),
    ]);
  });

  it("keeps a PDF found before the total limit", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { res: pdf };
    net.routes[B] = { ms: 5_000, res: pdf };
    const got = await run([A, B], net, { totalMs: 150, holdMs: 1_000 });
    expect(got.found?.url).toBe(A);
  });

  it("ends one candidate at the per-URL limit as an error attempt", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 1_500, res: pdf };
    const got = await run([A], net, { perUrlMs: 80 });
    expect(got.attempts).toEqual([{ source: "s:a.example", url: A, outcome: "error" }]);
  });

  it("ends a hop that sends no headers within the first-byte limit as an error attempt", async () => {
    const net = makeSlowNetwork();
    net.routes[A] = { ms: 1_500, res: pdf };
    const got = await run([A], net, { firstByteMs: 80 });
    expect(got.attempts).toEqual([{ source: "s:a.example", url: A, outcome: "error" }]);
  });
});
