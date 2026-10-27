/** Contract of the one download rule: bytes prove a PDF, interstitials are followed a few hops, bot checks are reported. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fetchPdf, isBotCheck, isPdfBytes, extractNextHopsFromHtml, type InTabAnswer } from "@labshelf/core";

import { downloadPdf, type HopSettings } from "../../../../src/import/pdfFinder/client";
import { createResolverEnv } from "../../../../src/import/pdfFinder/finder";
import { PDF, html, makeFindingHarness, pdf } from "../../../support/pdfFindingHarness";

const fixture = (name: string): string => readFileSync(join(__dirname, "..", "..", "..", "fixtures", name), "utf8");
const refresh = (target: string): string => `<html><head><meta http-equiv="refresh" content="0; url=${target}"></head></html>`;
const hopSettings = (referer?: string): HopSettings => ({ signal: AbortSignal.timeout(5_000), firstByteMs: 5_000, ...(referer ? { referer } : {}) });
const challenge = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf_chl_opt</body></html>";

describe("nextHopsFromHtml", () => {
  it("follows an interstitial's redirect to the real file", () => {
    const hops = extractNextHopsFromHtml(fixture("sciencedirectInterstitial.html"), "https://www.sciencedirect.com/science/article/pii/X/pdfft");
    expect(hops[0]).toBe("https://pdf.sciencedirectassets.com/272/1-s2.0-0196677482900074/main.pdf?X-Amz-Token=abc&X-Amz-Date=20261007");
  });

  it("finds nothing worth following on a login wall", () => {
    expect(extractNextHopsFromHtml(fixture("loginWall.html"), "https://publisher.example/login")).toEqual([]);
  });
});

describe("fetchPdf", () => {
  it("returns a PDF served directly, whatever its content-type says", async () => {
    const h = makeFindingHarness();
    h.routes["https://a.example/p.pdf"] = pdf;
    const got = await fetchPdf("https://a.example/p.pdf", h.opts());
    expect(got?.url).toBe("https://a.example/p.pdf");
    expect(isPdfBytes(got!.bytes)).toBe(true);
  });

  it("does not take a response with bytes before the PDF header for a PDF", async () => {
    const h = makeFindingHarness();
    h.routes["https://a.example/p.pdf"] = () => new Response(new TextEncoder().encode("\n\n%PDF-1.4"));
    expect(await fetchPdf("https://a.example/p.pdf", h.opts())).toBeUndefined();
  });

  it("walks through an interstitial page to the file", async () => {
    const h = makeFindingHarness();
    const target = "https://pdf.sciencedirectassets.com/272/1-s2.0-0196677482900074/main.pdf?X-Amz-Token=abc&X-Amz-Date=20261007";
    h.routes["https://www.sciencedirect.com/pdfft"] = () => html(fixture("sciencedirectInterstitial.html"));
    h.routes[target] = pdf;
    expect((await fetchPdf("https://www.sciencedirect.com/pdfft", h.opts()))?.url).toBe(target);
  });

  it("gives up on a login wall without following its unrelated links", async () => {
    const h = makeFindingHarness();
    h.routes["https://publisher.example/doi/pdf/10.1/x"] = () => html(fixture("loginWall.html"));
    expect(await fetchPdf("https://publisher.example/doi/pdf/10.1/x", h.opts())).toBeUndefined();
    expect(h.calls).toHaveLength(1);
  });

  it("follows at most three interstitial hops", async () => {
    const h = makeFindingHarness();
    for (let i = 0; i < 4; i++) h.routes[`https://hop.example/${i}`] = () => html(refresh(`https://hop.example/${i + 1}`));
    h.routes["https://hop.example/4"] = pdf;
    expect(await fetchPdf("https://hop.example/0", h.opts())).toBeUndefined();
    expect(h.calls).toEqual([0, 1, 2, 3].map((i) => `https://hop.example/${i}`));
  });

  it("calls the host's fetch as a bare function, so a browser fetch does not throw Illegal invocation", async () => {
    const hostFetch = { fetch(this: unknown): Promise<Response> {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      return Promise.resolve(pdf());
    } }.fetch;
    expect((await fetchPdf("https://a.example/p.pdf", { fetch: hostFetch as typeof fetch }))?.url).toBe("https://a.example/p.pdf");
  });

  it("sends the credentials and headers it was given", async () => {
    const seen: unknown[] = [];
    const hostFetch = (async (_url: unknown, init: unknown) => { seen.push(init); return pdf(); }) as typeof fetch;
    await fetchPdf("https://a.example/p.pdf", { fetch: hostFetch, credentials: "include", headers: { "User-Agent": "LabShelf" } });
    expect(seen[0]).toMatchObject({ credentials: "include", headers: { "User-Agent": "LabShelf" } });
  });

  it("logs a network error and returns nothing", async () => {
    const h = makeFindingHarness();
    h.routes["https://down.example/p.pdf"] = () => { throw new TypeError("Failed to fetch"); };
    expect(await fetchPdf("https://down.example/p.pdf", h.opts())).toBeUndefined();
    expect(h.logs).toEqual([expect.objectContaining({ level: "WARN", module: "pdfFinding", context: expect.objectContaining({ url: "https://down.example/p.pdf", error: "Failed to fetch" }) })]);
  });

  describe("size cap", () => {
    const declared = (bytes: number): Response => new Response(PDF, { headers: { "content-length": String(bytes) } });

    it("accepts a PDF declared up to 200 MB", async () => {
      const h = makeFindingHarness();
      h.routes["https://big.example/p.pdf"] = () => declared(150 * 1024 * 1024);
      expect(await fetchPdf("https://big.example/p.pdf", h.opts())).toBeDefined();
    });

    it("refuses a PDF declared past 200 MB without reading it", async () => {
      const h = makeFindingHarness();
      h.routes["https://huge.example/p.pdf"] = () => declared(201 * 1024 * 1024);
      expect(await fetchPdf("https://huge.example/p.pdf", h.opts())).toBeUndefined();
    });
  });

  describe("timeout", () => {
    afterEach(() => jest.restoreAllMocks());

    it("abandons a download that has not answered in 30 s", async () => {
      const deadline = new AbortController();
      const timeout = jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
      const hostFetch = ((_url: unknown, init: { signal: AbortSignal }) => new Promise<Response>((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
      const pending = fetchPdf("https://slow.example/p.pdf", { fetch: hostFetch });
      expect(timeout).toHaveBeenCalledWith(30_000);
      deadline.abort();
      expect(await pending).toBeUndefined();
    });
  });
});

describe("bot checks", () => {
  it("recognises a Cloudflare challenge, not an ordinary error page", () => {
    expect(isBotCheck(403, challenge)).toBe(true);
    expect(isBotCheck(404, challenge)).toBe(false);
    expect(isBotCheck(403, "<title>Forbidden</title>")).toBe(false);
  });

  it("sees a block message placed after a huge inline stylesheet", () => {
    const page = `<html><head><style>${"x".repeat(900_000)}</style></head><body>There was a problem providing the content you requested ::CLOUDFLARE_ERROR_1000S_BOX::</body></html>`;
    expect(isBotCheck(403, page)).toBe(true);
  });

  it("reports a challenged URL as blocked, logs it and does not follow its links", async () => {
    const h = makeFindingHarness();
    const url = "https://dl.acm.org/doi/pdf/10.1145/1";
    h.routes[url] = () => html(challenge, 403);
    const outcome = await downloadPdf(url, h.opts(), createResolverEnv(h.opts()), hopSettings());
    expect(outcome).toEqual({ blocked: [url], outcome: "bot", status: 403 });
    expect(h.logs).toEqual([expect.objectContaining({ level: "WARN", message: "bot check", context: expect.objectContaining({ url }) })]);
  });
});

describe("downloadPdf hops", () => {
  const seenReferers = (): { seen: Array<string | undefined>; opts: () => Parameters<typeof downloadPdf>[1]; routes: Record<string, () => Response> } => {
    const routes: Record<string, () => Response> = {};
    const seen: Array<string | undefined> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.["Referer"]);
      return routes[String(input)]?.() ?? new Response("nope", { status: 404 });
    }) as typeof globalThis.fetch;
    return { seen, routes, opts: () => ({ fetch }) };
  };

  it("sends the landing URL as Referer on every hop", async () => {
    const net = seenReferers();
    net.routes["https://a.example/start"] = () => html(refresh("https://a.example/real.pdf"));
    net.routes["https://a.example/real.pdf"] = pdf;
    const landing = "https://publisher.example/article/1";
    const outcome = await downloadPdf("https://a.example/start", net.opts(), createResolverEnv(net.opts()), hopSettings(landing));
    expect(outcome.outcome).toBe("pdf");
    expect(net.seen).toEqual([landing, landing]);
  });

  it("sends no Referer when none is given", async () => {
    const net = seenReferers();
    net.routes["https://a.example/p.pdf"] = pdf;
    await downloadPdf("https://a.example/p.pdf", net.opts(), createResolverEnv(net.opts()), hopSettings());
    expect(net.seen).toEqual([undefined]);
  });

  it("reports login, with the login hop's status, when a login hop is followed by a failed hop", async () => {
    const net = seenReferers();
    net.routes["https://a.example/start"] = () => html(fixture("loginWall.html"));
    // The tab's session sees a page that points on to a URL that fails.
    const fetchInTab = async (): Promise<InTabAnswer> => ({ finalUrl: "https://a.example/start", html: refresh("https://a.example/gone") });
    const opts = { ...net.opts(), tab: { url: "https://a.example/article", fetchInTab } };
    const outcome = await downloadPdf("https://a.example/start", opts, createResolverEnv(opts), hopSettings());
    expect(outcome).toEqual({ blocked: [], outcome: "login", status: 200 });
  });
});

describe("the tab's session", () => {
  const fetchInTab = jest.fn(async (): Promise<InTabAnswer | undefined> => ({ finalUrl: "https://publisher.example/p.pdf", pdf: { bytes: PDF, url: "https://publisher.example/p.pdf" } }));

  it("fetches a same-site URL from inside the tab when the background fetch got nothing", async () => {
    const h = makeFindingHarness();
    const got = await fetchPdf("https://publisher.example/p.pdf", h.opts({ tab: { url: "https://www.publisher.example/article/1", fetchInTab } }));
    expect(got?.url).toBe("https://publisher.example/p.pdf");
    expect(fetchInTab).toHaveBeenCalledWith("https://publisher.example/p.pdf");
  });

  it("never uses the tab for another site", async () => {
    const h = makeFindingHarness();
    const got = await fetchPdf("https://other.example/p.pdf", h.opts({ tab: { url: "https://publisher.example/article/1", fetchInTab } }));
    expect(got).toBeUndefined();
    expect(fetchInTab).not.toHaveBeenCalled();
  });
});
