/** Contract of the resolver chain: the order candidates are tried in, what is downloaded, how a miss is explained. */
import { resolvePdf } from "@labshelf/core";
import type { PdfAttempt } from "@labshelf/core";

import { PDF, html, json, makeContext, makeFindingHarness, pdf } from "../../support/pdfFindingHarness";

describe("resolvePdf", () => {
  it("prefers the page's own link over lookups that start at once, and labels it with whoever offered it", async () => {
    const h = makeFindingHarness();
    h.routes["https://scholar-pdf.example/p.pdf"] = pdf;
    const got = await resolvePdf(makeContext({ pageCandidates: [{ url: "https://scholar-pdf.example/p.pdf", source: "scholar" }], doi: "10.1145/1.2" }), h.opts());
    expect(got).toMatchObject({ source: "scholar", url: "https://scholar-pdf.example/p.pdf" });
    expect(h.calls).toContain("https://doi.org/10.1145/1.2");
  });

  it("skips a supplementary file an aggregator lists as the paper's PDF", async () => {
    const h = makeFindingHarness();
    const supplement = "https://static-content.springer.com/esm/art%3A10.1038%2Fnature12373/MediaObjects/41586_2013_BFnature12373_MOESM63_ESM.pdf";
    h.routes[supplement] = pdf;
    h.routes["https://repo.example/article.pdf"] = pdf;
    const got = await resolvePdf(makeContext({
      pageCandidates: [{ url: supplement, source: "page" }, { url: "https://repo.example/article.pdf", source: "page" }],
    }), h.opts());
    expect(got?.url).toBe("https://repo.example/article.pdf");
    expect(h.calls).not.toContain(supplement);
  });

  it("falls through a login wall to the publisher URL built from the DOI", async () => {
    const h = makeFindingHarness();
    h.routes["https://site.example/paper.pdf"] = () => html("<html><title>Sign in</title></html>");
    h.routes["https://epubs.siam.org/doi/pdf/10.1137/S0895479802410815"] = pdf;
    const attempts: PdfAttempt[] = [];
    const got = await resolvePdf(makeContext({
      doi: "10.1137/S0895479802410815",
      pageCandidates: [{ url: "https://site.example/paper.pdf", source: "page" }],
    }), h.opts(), attempts);
    expect(got?.source).toBe("publisher");
    expect(attempts.map((a) => a.source)).toEqual(["page", "publisher"]);
  });

  it("records each candidate's outcome and HTTP status, from the hop that decided it", async () => {
    const h = makeFindingHarness();
    const wall = "https://wall.example/p.pdf";
    const missing = "https://gone.example/p.pdf";
    const down = "https://down.example/p.pdf";
    const good = "https://good.example/p.pdf";
    h.routes[wall] = () => html("<form><input type=password></form>");
    h.routes[down] = () => { throw new TypeError("Failed to fetch"); };
    h.routes[good] = pdf;
    const attempts: PdfAttempt[] = [];
    const pageCandidates = [wall, missing, down, good].map((url) => ({ url, source: "page" }));
    await resolvePdf(makeContext({ pageCandidates }), h.opts(), attempts);
    expect(attempts).toEqual([
      { source: "page", url: wall, outcome: "login", status: 200 },
      { source: "page", url: missing, outcome: "error", status: 404 },
      { source: "page", url: down, outcome: "error" },
      { source: "page", url: good, outcome: "pdf", status: 200 },
    ]);
  });

  it("asks Unpaywall with the contact email and uses its open-access copy", async () => {
    const h = makeFindingHarness();
    h.routes["https://api.unpaywall.org/v2/10.9999%2Foa?email=me%40uni.edu"] = () =>
      json({ best_oa_location: { url_for_pdf: "https://repo.example/oa.pdf", version: "submittedVersion" } });
    h.routes["https://repo.example/oa.pdf"] = pdf;
    expect((await resolvePdf(makeContext({ doi: "10.9999/oa" }), h.opts()))?.source).toBe("unpaywall");
  });

  it("contacts no custom host unless a resolver is configured", async () => {
    const h = makeFindingHarness();
    await resolvePdf(makeContext({ doi: "10.9999/closed" }), h.opts());
    expect(h.calls.some((u) => u.startsWith("https://mirror.example"))).toBe(false);
  });

  it("attaches the PDF a configured resolver's page links when no other source has the paper", async () => {
    const h = makeFindingHarness();
    h.routes["https://mirror.example/find/10.9999/closed"] = () => html('<embed type="application/pdf" src="//files.example/x.pdf#navpanes=0">');
    h.routes["https://files.example/x.pdf#navpanes=0"] = pdf;
    const customResolvers = [{ name: "Mirror", template: "https://mirror.example/find/{doi}", enabled: true }];
    const got = await resolvePdf(makeContext({ doi: "10.9999/closed", customResolvers }), h.opts());
    expect(got).toMatchObject({ source: "custom", url: "https://files.example/x.pdf#navpanes=0" });
  });

  it("labels an arXiv-only paper's PDF a preprint", async () => {
    const h = makeFindingHarness();
    h.routes["https://arxiv.org/pdf/2301.00001"] = pdf;
    expect(await resolvePdf(makeContext({ arxivId: "2301.00001" }), h.opts())).toMatchObject({ source: "arxiv", version: "preprint" });
  });

  it("prefers the published copy over arXiv's preprint, whichever answers first", async () => {
    const h = makeFindingHarness();
    h.routes["https://arxiv.org/pdf/2301.00001"] = pdf;
    h.routes["https://dl.acm.org/doi/pdf/10.1145/1.2"] = () => new Promise<Response>((resolve) => setTimeout(() => resolve(pdf()), 40));
    expect(await resolvePdf(makeContext({ arxivId: "2301.00001", doi: "10.1145/1.2" }), h.opts())).toMatchObject({ source: "publisher", version: "published" });
  });

  it("does not return a copy that is no better than the one the paper has", async () => {
    const h = makeFindingHarness();
    h.routes["https://arxiv.org/pdf/2301.00001"] = pdf;
    expect(await resolvePdf(makeContext({ arxivId: "2301.00001", betterThan: "preprint" }), h.opts())).toBeUndefined();
  });

  it("returns undefined when nothing downloads as a PDF", async () => {
    const h = makeFindingHarness();
    expect(await resolvePdf(makeContext({ arxivId: "2301.00001" }), h.opts())).toBeUndefined();
  });

  it("works with the global fetch when the host supplies none", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => pdf()) as typeof fetch;
    try {
      expect((await resolvePdf(makeContext({ arxivId: "2301.00001" })))?.source).toBe("arxiv");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the order of the chain", () => {
  const OPENALEX = "https://api.openalex.org/";

  it("downloads candidates in rank order whatever order the lookups answer in", async () => {
    const h = makeFindingHarness();
    const delayed = (ms: number, body: () => Response) => () => new Promise<Response>((resolve) => setTimeout(() => resolve(body()), ms));
    h.routes[`${OPENALEX}works/doi:10.1145%2F1.2?select=id,doi,title,publication_year,authorships,ids,open_access,best_oa_location,locations&mailto=me%40uni.edu`] = delayed(60, () => json({
      title: "Attention is all you need",
      best_oa_location: { pdf_url: "https://repo.example/openalex.pdf" },
      locations: [{ landing_page_url: "https://arxiv.org/abs/1706.03762v7" }],
    }));
    h.routes["https://api.unpaywall.org/v2/10.1145%2F1.2?email=me%40uni.edu"] = () => json({ best_oa_location: { url_for_pdf: "https://oa.example/unpaywall.pdf" } });
    const attempts: PdfAttempt[] = [];
    const ctx = makeContext({ doi: "10.1145/1.2", title: "Attention is all you need", pageCandidates: [{ url: "https://page.example/p.pdf", source: "page" }] });
    expect(await resolvePdf(ctx, h.opts(), attempts)).toBeUndefined();
    expect(attempts.map((a) => [a.source, a.url])).toEqual([
      ["page", "https://page.example/p.pdf"],
      ["publisher", "https://dl.acm.org/doi/pdf/10.1145/1.2"],
      ["openalex", "https://repo.example/openalex.pdf"],
      ["arxiv", "https://arxiv.org/pdf/1706.03762"],
      ["unpaywall", "https://oa.example/unpaywall.pdf"],
    ]);
  });

  it("keeps the better-ranked PDF when a lower-ranked one arrives first", async () => {
    const h = makeFindingHarness();
    h.routes["https://arxiv.org/pdf/2301.00001"] = () => new Promise<Response>((resolve) => setTimeout(() => resolve(pdf()), 60));
    h.routes["https://api.unpaywall.org/v2/10.1%2Fx?email=me%40uni.edu"] = () => json({ best_oa_location: { url_for_pdf: "https://repo.example/oa.pdf", version: "submittedVersion" } });
    h.routes["https://repo.example/oa.pdf"] = pdf;
    const attempts: PdfAttempt[] = [];
    const got = await resolvePdf(makeContext({ arxivId: "2301.00001", doi: "10.1/x" }), h.opts(), attempts);
    expect(got?.source).toBe("arxiv");
    expect(attempts.map((a) => [a.source, a.outcome])).toEqual([["arxiv", "pdf"], ["unpaywall", "pdf"]]);
  });

  it("downloads an arXiv paper the learners revealed, labelled arxiv", async () => {
    const h = makeFindingHarness();
    h.routes["https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x?fields=title,year,authors,externalIds,openAccessPdf"] = () =>
      json({ title: "T", externalIds: { ArXiv: "hep-th/9711200" } });
    h.routes["https://arxiv.org/pdf/hep-th/9711200"] = pdf;
    const got = await resolvePdf(makeContext({ doi: "10.1/x" }), h.opts());
    expect(got).toMatchObject({ source: "arxiv", url: "https://arxiv.org/pdf/hep-th/9711200" });
  });

  it("downloads the arXiv twin of a paper that has only a title", async () => {
    const h = makeFindingHarness();
    const title = "The Large N Limit of Superconformal Field Theories and Supergravity";
    h.routes[`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${title}"`)}+AND+au:maldacena&max_results=3`] = () =>
      new Response(`<feed><entry><id>http://arxiv.org/abs/hep-th/9711200v3</id><title>${title}</title><author><name>Juan Maldacena</name></author></entry></feed>`);
    h.routes["https://arxiv.org/pdf/hep-th/9711200"] = pdf;
    const got = await resolvePdf(makeContext({ title, authors: ["Juan Maldacena"] }), h.opts());
    expect(got).toMatchObject({ source: "arxiv", url: "https://arxiv.org/pdf/hep-th/9711200" });
  });

  it("fetches an arXiv PDF known from the start once", async () => {
    const h = makeFindingHarness();
    await resolvePdf(makeContext({ doi: "10.1/x", arxivId: "2301.00001" }), h.opts());
    expect(h.calls.filter((u) => u === "https://arxiv.org/pdf/2301.00001")).toHaveLength(1);
  });

  it("does not ask PubMed for a DOI", async () => {
    const h = makeFindingHarness();
    await resolvePdf(makeContext({ pmid: "12345" }), h.opts());
    expect(h.calls.some((u) => u.includes("eutils.ncbi.nlm.nih.gov"))).toBe(false);
  });

  it("uses a copy a learner suggests only when the record is the same work", async () => {
    const lookup = "https://api.openalex.org/works/doi:10.1%2Fx?select=id,doi,title,publication_year,authorships,ids,open_access,best_oa_location,locations&mailto=me%40uni.edu";
    const record = (title: string) => () => json({ title, best_oa_location: { pdf_url: "https://repo.example/copy.pdf" } });
    const same = makeFindingHarness();
    same.routes[lookup] = record("Attention is all you need");
    same.routes["https://repo.example/copy.pdf"] = pdf;
    expect((await resolvePdf(makeContext({ doi: "10.1/x", title: "Attention Is All You Need" }), same.opts()))?.source).toBe("openalex");

    const other = makeFindingHarness();
    other.routes[lookup] = record("A different paper");
    other.routes["https://repo.example/copy.pdf"] = pdf;
    expect(await resolvePdf(makeContext({ doi: "10.1/x", title: "Attention Is All You Need" }), other.opts())).toBeUndefined();
    expect(other.calls).not.toContain("https://repo.example/copy.pdf");
  });
});

describe("a bot-checked candidate", () => {
  const url = "https://dl.acm.org/doi/pdf/10.1145/1.2";
  const challenge = (): Response => html("<title>Just a moment...</title>", 403);

  it("is retried through a real tab, once, and the PDF it gets is credited to the candidate", async () => {
    const h = makeFindingHarness();
    h.routes[url] = challenge;
    const viaHelperTab = jest.fn(async (urls: string[]) => ({ bytes: PDF, url: urls[0]! }));
    const attempts: PdfAttempt[] = [];
    const got = await resolvePdf(makeContext({ pageCandidates: [{ url, source: "scholar" }] }), h.opts({ viaHelperTab }), attempts);
    expect(got?.source).toBe("scholar");
    expect(viaHelperTab).toHaveBeenCalledTimes(1);
    expect(viaHelperTab).toHaveBeenCalledWith([url], expect.any(AbortSignal));
    expect(attempts).toEqual([{ source: "scholar", url, outcome: "pdf" }]);
  });

  it("is not retried when the host has no tab, and the miss is still explained", async () => {
    const h = makeFindingHarness();
    h.routes[url] = challenge;
    const attempts: PdfAttempt[] = [];
    expect(await resolvePdf(makeContext({ pageCandidates: [{ url, source: "scholar" }] }), h.opts(), attempts)).toBeUndefined();
    expect(attempts).toEqual([{ source: "scholar", url, outcome: "bot", status: 403 }]);
  });

  it("logs a failing tab instead of throwing", async () => {
    const h = makeFindingHarness();
    h.routes[url] = challenge;
    const viaHelperTab = jest.fn(async () => { throw new Error("no tabs permission"); });
    expect(await resolvePdf(makeContext({ pageCandidates: [{ url, source: "scholar" }] }), h.opts({ viaHelperTab }))).toBeUndefined();
    expect(h.logs.filter((l) => l.message === "helper tab failed")).toHaveLength(1);
  });
});
