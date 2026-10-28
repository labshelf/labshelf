/** Contract of the lookup stage: all lookups start together, each under its own cap, candidates come out in rank order. */
import { walkRankedCandidates, startFinds, type Candidate } from "../../../../src/import/pdfFinder/engine";
import type { ResolveContext } from "../../../../src/import/pdfFinder/finder";
import { json, makeContext } from "../../../support/pdfFindingHarness";
import { makeSlowNetwork, redirectedTo, type SlowNetwork } from "../../../support/slowNetwork";

const DOI = "10.1145/1.2";
const UNPAYWALL = `https://api.unpaywall.org/v2/${encodeURIComponent(DOI)}?email=me%40uni.edu`;
const S2 = `https://api.semanticscholar.org/graph/v1/paper/DOI:${DOI}?fields=title,year,authors,externalIds,openAccessPdf`;
const SCIENCEDIRECT = "https://www.sciencedirect.com/science/article/pii/S0196677482900074";

async function collect(ctx: ResolveContext, net: SlowNetwork, capMs = 2_000): Promise<Candidate[]> {
  const steps = startFinds(ctx, {}, net.env, capMs, new AbortController().signal);
  const out: Candidate[] = [];
  for await (const c of walkRankedCandidates(steps)) out.push(c);
  return out;
}

describe("startLookups and rankedCandidates", () => {
  it("yields candidates by rank, labelled by whoever proposed them, not by arrival", async () => {
    const net = makeSlowNetwork();
    net.routes[UNPAYWALL] = { res: () => json({ best_oa_location: { url_for_pdf: "https://oa.example/p.pdf" } }) };
    net.routes[S2] = { ms: 80, res: () => json({ title: "T", openAccessPdf: { url: "https://s2.example/p.pdf" } }) };
    const got = await collect(makeContext({
      doi: DOI, arxivId: "2301.00001", pageCandidates: [{ url: "https://page.example/p.pdf", source: "scholar" }],
    }), net);
    expect(got.map((c) => [c.source, c.url])).toEqual([
      ["scholar", "https://page.example/p.pdf"],
      ["publisher", "https://dl.acm.org/doi/pdf/10.1145/1.2"],
      ["arxiv", "https://arxiv.org/pdf/2301.00001"],
      ["semantic-scholar", "https://s2.example/p.pdf"],
      ["unpaywall", "https://oa.example/p.pdf"],
    ]);
  });

  it("starts every independent lookup before a slow one answers", async () => {
    const net = makeSlowNetwork();
    net.routes[`https://doi.org/${DOI}`] = { ms: 300, res: () => redirectedTo("https://x.example/a", "<html></html>") };
    const pending = collect(makeContext({ doi: DOI }), net);
    await new Promise((r) => setTimeout(r, 100));
    const early = net.calls.map((c) => c.url);
    expect(early).toEqual(expect.arrayContaining([UNPAYWALL, S2, `https://doi.org/${DOI}`]));
    expect(early.some((u) => u.startsWith("https://api.crossref.org/"))).toBe(true);
    await pending;
  });

  it("drops a lookup that answers after the cap while the others still count", async () => {
    const net = makeSlowNetwork();
    net.routes[UNPAYWALL] = { ms: 2_000, res: () => json({ best_oa_location: { url_for_pdf: "https://oa.example/p.pdf" } }) };
    const started = Date.now();
    const got = await collect(makeContext({ doi: DOI, arxivId: "2301.00001" }), net, 100);
    expect(got.map((c) => c.source)).toEqual(["publisher", "arxiv"]);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(net.cancelled).toContain(UNPAYWALL);
  });

  it("takes an arXiv id a learner reveals after the learners settle, once", async () => {
    const net = makeSlowNetwork();
    net.routes[S2] = { ms: 80, res: () => json({ title: "T", externalIds: { ArXiv: "hep-th/9711200" } }) };
    const got = await collect(makeContext({ doi: DOI }), net);
    expect(got.filter((c) => c.source === "arxiv")).toEqual([{ url: "https://arxiv.org/pdf/hep-th/9711200", source: "arxiv", version: "preprint" }]);
  });

  it("proposes a URL once even when two lookups offer it", async () => {
    const net = makeSlowNetwork();
    const got = await collect(makeContext({ arxivId: "2301.00001", pageCandidates: [{ url: "https://arxiv.org/pdf/2301.00001", source: "page" }] }), net);
    expect(got.map((c) => c.source)).toEqual(["page"]);
  });

  it("skips a supplementary file", async () => {
    const net = makeSlowNetwork();
    const supplement = "https://static-content.springer.com/esm/art%3A10.1038%2Fnature12373/MediaObjects/41586_2013_BFnature12373_MOESM63_ESM.pdf";
    const got = await collect(makeContext({ pageCandidates: [{ url: supplement, source: "page" }] }), net);
    expect(got).toEqual([]);
  });

  it("still yields the lookups that need no network when the network throws", async () => {
    const net = makeSlowNetwork();
    const throwing = { ...net.env, fetch: (() => { throw new Error("boom"); }) as typeof fetch };
    const steps = startFinds(makeContext({ doi: DOI, arxivId: "2301.00001" }), {}, throwing, 500, new AbortController().signal);
    const out: Candidate[] = [];
    for await (const c of walkRankedCandidates(steps)) out.push(c);
    expect(out.map((c) => c.source)).toEqual(["publisher", "arxiv"]);
  });
});

describe("candidate versions", () => {
  const OA = "https://oa.example/accepted.pdf";
  const PRE = "https://repo.example/submitted.pdf";

  function withLabels(net: SlowNetwork): void {
    net.routes[UNPAYWALL] = {
      res: () => json({
        best_oa_location: { url_for_pdf: OA, version: "acceptedVersion" },
        oa_locations: [{ url_for_pdf: PRE, version: "submittedVersion" }, { url_for_pdf: "https://mirror.example/p.pdf" }],
      }),
    };
  }

  it("labels a candidate with its source's label, its preprint server or its publisher rule, and leaves the rest unlabelled", async () => {
    const net = makeSlowNetwork();
    withLabels(net);
    const got = await collect(makeContext({ doi: DOI, arxivId: "2301.00001" }), net);
    expect(got.map((c) => [c.url, c.version])).toEqual([
      ["https://dl.acm.org/doi/pdf/10.1145/1.2", "published"],
      ["https://arxiv.org/pdf/2301.00001", "preprint"],
      [OA, "accepted"],
      [PRE, "preprint"],
      ["https://mirror.example/p.pdf", undefined],
    ]);
    expect(got.at(-1)).not.toHaveProperty("version");
  });

  it("drops the preprints and keeps the accepted, published and unlabelled copies when the paper has a preprint already", async () => {
    const net = makeSlowNetwork();
    withLabels(net);
    const got = await collect(makeContext({ doi: DOI, arxivId: "2301.00001", betterThan: "preprint" }), net);
    expect(got.map((c) => c.url)).toEqual(["https://dl.acm.org/doi/pdf/10.1145/1.2", OA, "https://mirror.example/p.pdf"]);
  });

  it("wants only published and unlabelled copies when the paper has an accepted version already", async () => {
    const net = makeSlowNetwork();
    withLabels(net);
    const got = await collect(makeContext({ doi: DOI, arxivId: "2301.00001", betterThan: "accepted" }), net);
    expect(got.map((c) => c.url)).toEqual(["https://dl.acm.org/doi/pdf/10.1145/1.2", "https://mirror.example/p.pdf"]);
  });

  it("keeps every candidate when the paper has no PDF", async () => {
    const net = makeSlowNetwork();
    withLabels(net);
    const got = await collect(makeContext({ doi: DOI, arxivId: "2301.00001" }), net);
    expect(got).toHaveLength(5);
  });
});

describe("the landing lookup", () => {
  const page = `<html><head><meta name="citation_pdf_url" content="https://cdn.example/full.pdf"></head></html>`;

  it("opens the DOI's page, labels its PDF link landing and lets a ScienceDirect rule fire on the landing URL", async () => {
    const net = makeSlowNetwork();
    net.routes[`https://doi.org/10.1016/0196-6774(82)90007-4`] = { ms: 60, res: () => redirectedTo(SCIENCEDIRECT, page) };
    const ctx = makeContext({ doi: "10.1016/0196-6774(82)90007-4" });
    const got = await collect(ctx, net);
    expect(ctx.landingUrl).toBe(SCIENCEDIRECT);
    expect(got.map((c) => [c.source, c.url])).toEqual(expect.arrayContaining([
      ["landing", "https://cdn.example/full.pdf"],
      ["publisher", "https://www.sciencedirect.com/science/article/pii/S0196677482900074/pdfft?isDTMRedir=true&download=true"],
    ]));
    expect(got.findIndex((c) => c.source === "landing")).toBeLessThan(got.findIndex((c) => c.source === "publisher"));
  });

  it("fires the IEEE rule from the landing URL", async () => {
    const net = makeSlowNetwork();
    net.routes[`https://doi.org/10.1109/5.771073`] = { res: () => redirectedTo("https://ieeexplore.ieee.org/document/771073", "<html></html>") };
    const got = await collect(makeContext({ doi: "10.1109/5.771073" }), net);
    expect(got.map((c) => c.url)).toContain("https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=771073");
  });

  it("does not open the page when the landing URL is already known", async () => {
    const net = makeSlowNetwork();
    const got = await collect(makeContext({ doi: DOI, landingUrl: SCIENCEDIRECT }), net);
    expect(net.calls.some((c) => c.url.startsWith("https://doi.org/"))).toBe(false);
    expect(got.map((c) => c.source)).toEqual(["publisher", "publisher"]);
  });

  it("does not open a page without a DOI", async () => {
    const net = makeSlowNetwork();
    await collect(makeContext({ arxivId: "2301.00001" }), net);
    expect(net.calls.some((c) => c.url.startsWith("https://doi.org/"))).toBe(false);
  });

  it("leaves the landing URL unset when the page cannot be read", async () => {
    const net = makeSlowNetwork();
    const ctx = makeContext({ doi: DOI });
    await collect(ctx, net);
    expect(ctx.landingUrl).toBeUndefined();
  });
});
