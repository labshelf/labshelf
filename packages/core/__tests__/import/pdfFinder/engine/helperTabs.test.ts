/** Contract of the helper-tab retry: a wall goes to a tab as soon as it is seen, one tab per site, and a better PDF cancels it. */
import { downloadBest } from "../../../../src/import/pdfFinder/engine";
import type { EngineLimits } from "../../../../src/import/pdfFinder/deadline";
import type { FetchedPdf, PdfAttempt, PdfFetchOptions } from "../../../../src/import/pdfFinder/finder";
import { PDF, pdf, makeContext, html } from "../../../support/pdfFindingHarness";
import { candidatesOf, FAST_LIMITS, makeSlowNetwork } from "../../../support/slowNetwork";

const WALLED = "https://walled.example/a.pdf";
const WALLED_TOO = "https://walled.example/b.pdf";
const OPEN = "https://open.example/p.pdf";
const wall = (): Response => html("<title>Just a moment...</title>", 403);

type HelperTab = NonNullable<PdfFetchOptions["viaHelperTab"]>;

async function run(urls: string[], net: ReturnType<typeof makeSlowNetwork>, viaHelperTab: HelperTab, limits: Partial<EngineLimits> = {}) {
  const attempts: PdfAttempt[] = [];
  const found = await downloadBest(makeContext(), candidatesOf(...urls), { opts: { viaHelperTab }, env: net.env, limits: { ...FAST_LIMITS, ...limits } }, attempts);
  return { found, attempts };
}

// A tab that answers after `ms`, or rejects when the run aborts its signal.
function slowTab(ms: number, answer: (urls: string[]) => FetchedPdf | undefined): jest.Mock<ReturnType<HelperTab>, Parameters<HelperTab>> {
  return jest.fn((urls: string[], signal: AbortSignal) => new Promise<FetchedPdf | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(answer(urls)), ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }));
}

describe("the helper-tab retry", () => {
  it("starts at the wall, without waiting for the rest of the chain, and its PDF outranks a later candidate's", async () => {
    const net = makeSlowNetwork();
    net.routes[WALLED] = { res: wall };
    net.routes[OPEN] = { ms: 60, res: pdf };
    const tab = slowTab(150, (urls) => ({ bytes: PDF, url: urls[0]! }));
    const got = await run([WALLED, OPEN], net, tab, { holdMs: 1_000 });
    expect(got.found).toMatchObject({ url: WALLED, source: "s:walled.example" });
    expect(got.attempts.map((a) => [a.url, a.outcome])).toEqual([[WALLED, "pdf"], [OPEN, "pdf"]]);
  });

  it("does not hold a download slot while the tab works", async () => {
    const net = makeSlowNetwork();
    net.routes[WALLED] = { res: wall };
    net.routes[OPEN] = { res: () => html("no pdf here") };
    const tab = slowTab(300, () => undefined);
    const started = Date.now();
    await run([WALLED, OPEN], net, tab, { concurrency: 1 });
    expect(net.calls.find((c) => c.url === OPEN)!.at - started).toBeLessThan(150);
  });

  it("opens one tab per site, and a second candidate walled on that site reports the wall", async () => {
    const net = makeSlowNetwork();
    net.routes[WALLED] = { res: wall };
    net.routes[WALLED_TOO] = { res: wall };
    const tab = slowTab(50, () => undefined);
    const got = await run([WALLED, WALLED_TOO], net, tab);
    expect(tab).toHaveBeenCalledTimes(1);
    expect(got.found).toBeUndefined();
    expect(got.attempts.map((a) => [a.url, a.outcome, a.status])).toEqual([[WALLED, "bot", 403], [WALLED_TOO, "bot", 403]]);
  });

  it("opens no more tabs than the run allows", async () => {
    const net = makeSlowNetwork();
    const sites = ["https://w1.example/p.pdf", "https://w2.example/p.pdf", "https://w3.example/p.pdf"];
    for (const u of sites) net.routes[u] = { res: wall };
    const tab = slowTab(10, () => undefined);
    await run(sites, net, tab, { helperTabSites: 2 });
    expect(tab.mock.calls.map(([urls]) => urls)).toEqual([[sites[0]], [sites[1]]]);
  });

  it("is cancelled when a better-ranked PDF wins, and the wall stays in the attempts", async () => {
    const net = makeSlowNetwork();
    net.routes[OPEN] = { ms: 40, res: pdf };
    net.routes[WALLED] = { res: wall };
    const tab = slowTab(5_000, () => undefined);
    const got = await run([OPEN, WALLED], net, tab);
    expect(got.found?.url).toBe(OPEN);
    expect(tab.mock.calls[0]![1].aborted).toBe(true);
    expect(got.attempts.map((a) => [a.url, a.outcome])).toEqual([[OPEN, "pdf"], [WALLED, "bot"]]);
    expect(net.logs.filter((l) => l.message === "helper tab failed")).toEqual([]);
  });

  it("keeps the wall as the candidate's outcome when the total limit cuts the tab off", async () => {
    const net = makeSlowNetwork();
    net.routes[WALLED] = { res: wall };
    const tab = slowTab(5_000, () => undefined);
    const got = await run([WALLED], net, tab, { totalMs: 150 });
    expect(got.found).toBeUndefined();
    expect(got.attempts).toEqual([{ source: "s:walled.example", url: WALLED, outcome: "bot", status: 403 }]);
  });
});
