/** Contract of the resolver chain: the order candidates are tried in, what is downloaded, how a miss is explained. */
import { resolvePdf } from "@labshelf/core";
import type { PdfAttempt } from "@labshelf/core";

import { PDF, html, json, makeContext, makeFindingHarness, pdf } from "../../support/pdfFindingHarness";

describe("resolvePdf", () => {
  it("prefers the page's own link and labels it with whoever offered it", async () => {
    const h = makeFindingHarness();
    h.routes["https://scholar-pdf.example/p.pdf"] = pdf;
    const got = await resolvePdf(makeContext({ pageCandidates: [{ url: "https://scholar-pdf.example/p.pdf", source: "scholar" }], doi: "10.1145/1.2" }), h.opts());
    expect(got?.source).toBe("scholar");
    expect(h.calls).toEqual(["https://scholar-pdf.example/p.pdf"]);
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

  it("asks Unpaywall with the contact email and uses its open-access copy", async () => {
    const h = makeFindingHarness();
    h.routes["https://api.unpaywall.org/v2/10.9999%2Foa?email=me%40uni.edu"] = () =>
      json({ best_oa_location: { url_for_pdf: "https://repo.example/oa.pdf" } });
    h.routes["https://repo.example/oa.pdf"] = pdf;
    expect((await resolvePdf(makeContext({ doi: "10.9999/oa" }), h.opts()))?.source).toBe("unpaywall");
  });

  it("never contacts the Sci-Hub mirror unless a mirror is configured", async () => {
    const h = makeFindingHarness();
    await resolvePdf(makeContext({ doi: "10.9999/closed" }), h.opts());
    expect(h.calls.some((u) => u.startsWith("https://mirror.example"))).toBe(false);
    await resolvePdf(makeContext({ doi: "10.9999/closed", sciHubMirror: "https://mirror.example" }), h.opts());
    expect(h.calls).toContain("https://mirror.example/10.9999/closed");
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
  const S2 = "https://api.semanticscholar.org/";
  const EPMC = "https://www.ebi.ac.uk/";
  const firstIndex = (calls: string[], prefix: string): number => calls.findIndex((u) => u.startsWith(prefix));

  it("tries the page, arXiv, the three learners, arXiv again for a learned id, PMC, the publisher, CrossRef, Unpaywall and Sci-Hub", async () => {
    const h = makeFindingHarness();
    h.routes[`${OPENALEX}works/doi:10.1145%2F1.2?select=id,doi,title,publication_year,ids,open_access,best_oa_location,locations&mailto=me%40uni.edu`] = () => json({
      title: "Attention is all you need",
      ids: { pmcid: "PMC5586528" },
      locations: [{ landing_page_url: "https://arxiv.org/abs/1706.03762v7" }],
    });
    const ctx = makeContext({
      doi: "10.1145/1.2", title: "Attention is all you need", sciHubMirror: "https://mirror.example",
      pageCandidates: [{ url: "https://page.example/p.pdf", source: "page" }],
    });
    expect(await resolvePdf(ctx, h.opts())).toBeUndefined();
    const order = [
      "https://page.example/p.pdf", OPENALEX, S2, EPMC, "https://arxiv.org/pdf/1706.03762", "https://pmc-oa-opendata.s3.amazonaws.com/",
      "https://dl.acm.org/doi/pdf/10.1145/1.2", "https://api.crossref.org/", "https://api.unpaywall.org/", "https://mirror.example/",
    ];
    const positions = order.map((prefix) => firstIndex(h.calls, prefix));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("downloads each resolver's candidates before asking the next resolver", async () => {
    const h = makeFindingHarness();
    h.routes["https://arxiv.org/pdf/2301.00001"] = pdf;
    expect((await resolvePdf(makeContext({ arxivId: "2301.00001", doi: "10.1/x" }), h.opts()))?.source).toBe("arxiv");
    expect(h.calls).toEqual(["https://arxiv.org/pdf/2301.00001"]);
  });

  it("downloads an arXiv paper the learners revealed, labelled arxiv", async () => {
    const h = makeFindingHarness();
    h.routes["https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x?fields=title,year,authors,externalIds,openAccessPdf"] = () =>
      json({ title: "T", externalIds: { ArXiv: "hep-th/9711200" } });
    h.routes["https://arxiv.org/pdf/hep-th/9711200"] = pdf;
    const got = await resolvePdf(makeContext({ doi: "10.1/x" }), h.opts());
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
    const lookup = "https://api.openalex.org/works/doi:10.1%2Fx?select=id,doi,title,publication_year,ids,open_access,best_oa_location,locations&mailto=me%40uni.edu";
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

  it("is retried through a real tab, once, after everything else failed", async () => {
    const h = makeFindingHarness();
    h.routes[url] = challenge;
    const viaHelperTab = jest.fn(async (urls: string[]) => ({ bytes: PDF, url: urls[0]! }));
    const attempts: PdfAttempt[] = [];
    const got = await resolvePdf(makeContext({ pageCandidates: [{ url, source: "scholar" }] }), h.opts({ viaHelperTab }), attempts);
    expect(got?.source).toBe("scholar");
    expect(viaHelperTab).toHaveBeenCalledTimes(1);
    expect(viaHelperTab).toHaveBeenCalledWith([url]);
    expect(attempts.at(-1)).toEqual({ source: "scholar (via tab)", url });
  });

  it("is not retried when the host has no tab, and the miss is still explained", async () => {
    const h = makeFindingHarness();
    h.routes[url] = challenge;
    const attempts: PdfAttempt[] = [];
    expect(await resolvePdf(makeContext({ pageCandidates: [{ url, source: "scholar" }] }), h.opts(), attempts)).toBeUndefined();
    expect(attempts).toEqual([{ source: "scholar", url }]);
  });

  it("logs a failing tab instead of throwing", async () => {
    const h = makeFindingHarness();
    h.routes[url] = challenge;
    const viaHelperTab = jest.fn(async () => { throw new Error("no tabs permission"); });
    expect(await resolvePdf(makeContext({ pageCandidates: [{ url, source: "scholar" }] }), h.opts({ viaHelperTab }))).toBeUndefined();
    expect(h.logs.filter((l) => l.message === "helper tab failed")).toHaveLength(1);
  });
});
