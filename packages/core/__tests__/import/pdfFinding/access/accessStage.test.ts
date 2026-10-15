/** Contract of the access stage: once nothing open was found, publisher sign-in pages are retried through the helper tab, then each enabled proxy. */
import { resolvePdf } from "@labshelf/core";
import type { LibraryProxy, PdfAttempt, PdfFetchOptions } from "@labshelf/core";

import { PDF, html, makeContext, makeFindingHarness, pdf } from "../../../support/pdfFindingHarness";

const PAYWALLED = "https://www.sciencedirect.com/science/article/pii/S0010027701001536/pdfft";
const OPEN_HOST = "https://www.mdpi.com/2073-4425/1/1/1/pdf";
const REPOSITORY = "https://repository.uni.example/bitstream/1/paper.pdf";
const PREFIX = "https://login.ezproxy.uni.edu/login?url=$@";
const viaProxy = (url: string): string => PREFIX.replace("$@", url);
// Publishers refuse a paper without access with a 403; a proxy shows its own sign-in form.
const signIn = (): Response => html("<form><input type=password name=pw></form>", 403);
const proxySignIn = (): Response => html("<form><input type=password name=pw></form>");
const proxy = (over: Partial<LibraryProxy> = {}): LibraryProxy => ({ name: "Uni library", template: PREFIX, enabled: true, ...over });

async function run(pages: string[], opts: PdfFetchOptions, h = makeFindingHarness()) {
  for (const url of pages) h.routes[url] ??= signIn;
  const attempts: PdfAttempt[] = [];
  const found = await resolvePdf(makeContext({ pageCandidates: pages.map((url) => ({ url, source: "page" })) }), h.opts(opts), attempts);
  return { found, attempts, calls: h.calls };
}

describe("the access stage", () => {
  it("retries a paywalled sign-in page through an enabled proxy, and leaves an open-access host alone", async () => {
    const h = makeFindingHarness();
    h.routes[viaProxy(PAYWALLED)] = pdf;
    const got = await run([OPEN_HOST, PAYWALLED], { proxies: [proxy()] }, h);
    expect(got.found).toEqual({ bytes: PDF, url: viaProxy(PAYWALLED), source: "page" });
    expect(got.calls).not.toContain(viaProxy(OPEN_HOST));
    expect(got.attempts.at(-1)).toMatchObject({ url: viaProxy(PAYWALLED), outcome: "pdf", proxy: "Uni library" });
  });

  it("retries a page on the article's own site even when the rule table does not know it, but not a repository", async () => {
    const h = makeFindingHarness();
    const own = "https://journal.society.example/article/1/pdf";
    const attempts: PdfAttempt[] = [];
    h.routes[own] = signIn;
    h.routes[REPOSITORY] = signIn;
    h.routes[viaProxy(own)] = pdf;
    const ctx = makeContext({ landingUrl: "https://journal.society.example/article/1", pageCandidates: [{ url: REPOSITORY, source: "page" }, { url: own, source: "page" }] });
    const found = await resolvePdf(ctx, h.opts({ proxies: [proxy()] }), attempts);
    expect(found?.url).toBe(viaProxy(own));
    expect(h.calls).not.toContain(viaProxy(REPOSITORY));
  });

  it("records a proxy that asks for its own sign-in, and stops sending it pages", async () => {
    const h = makeFindingHarness();
    const second = "https://onlinelibrary.wiley.com/doi/pdf/10.1002/abc";
    h.routes[viaProxy(PAYWALLED)] = proxySignIn;
    const got = await run([PAYWALLED, second], { proxies: [proxy()] }, h);
    expect(got.found).toBeUndefined();
    expect(got.attempts.filter((a) => a.proxy)).toEqual([{ source: "page", url: viaProxy(PAYWALLED), outcome: "login", status: 200, proxy: "Uni library" }]);
    expect(got.calls).not.toContain(viaProxy(second));
  });

  it("moves on to the next proxy when one asks for its own sign-in, recording each", async () => {
    const h = makeFindingHarness();
    const other = proxy({ name: "Hospital", template: "https://proxy.hospital.example/$@" });
    h.routes[viaProxy(PAYWALLED)] = proxySignIn;
    h.routes[`https://proxy.hospital.example/${PAYWALLED}`] = proxySignIn;
    const got = await run([PAYWALLED], { proxies: [proxy(), other] }, h);
    expect(got.found).toBeUndefined();
    expect(got.attempts.filter((a) => a.proxy).map((a) => [a.proxy, a.outcome])).toEqual([["Uni library", "login"], ["Hospital", "login"]]);
  });

  it("tries the proxies in order and skips a disabled one", async () => {
    const h = makeFindingHarness();
    const second = proxy({ name: "Hospital", template: ".ezproxy.hospital.example" });
    const byHost = "https://www-sciencedirect-com.ezproxy.hospital.example/science/article/pii/S0010027701001536/pdfft";
    h.routes[byHost] = pdf;
    const got = await run([PAYWALLED], { proxies: [proxy({ enabled: false }), proxy({ name: "Broken", template: "nonsense" }), second] }, h);
    expect(got.found?.url).toBe(byHost);
    expect(got.calls).not.toContain(viaProxy(PAYWALLED));
  });

  it("goes through the helper tab before any proxy", async () => {
    const h = makeFindingHarness();
    const viaHelperTab = jest.fn(async (urls: string[]) => ({ bytes: PDF, url: urls[0]! }));
    const got = await run([PAYWALLED], { viaHelperTab, proxies: [proxy()] }, h);
    expect(viaHelperTab).toHaveBeenCalledWith([PAYWALLED], expect.any(AbortSignal));
    expect(got.found).toMatchObject({ url: PAYWALLED, source: "page" });
    expect(got.calls).not.toContain(viaProxy(PAYWALLED));
  });

  it("sends nothing more when the run has no proxy and no helper tab", async () => {
    const got = await run([PAYWALLED], {});
    expect(got.found).toBeUndefined();
    expect(got.calls.filter((u) => u === PAYWALLED || u.includes("ezproxy"))).toEqual([PAYWALLED]);
  });

  it("does not run when an open candidate found the PDF", async () => {
    const h = makeFindingHarness();
    h.routes["https://open.example/p.pdf"] = pdf;
    const got = await run([PAYWALLED, "https://open.example/p.pdf"], { proxies: [proxy()] }, h);
    expect(got.found?.url).toBe("https://open.example/p.pdf");
    expect(got.calls).not.toContain(viaProxy(PAYWALLED));
  });
});
