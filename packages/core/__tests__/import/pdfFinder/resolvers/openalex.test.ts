/** Contract of the OpenAlex learner: identifiers for the resolvers that follow, publisher and repository copies, and nothing from another paper's record. */
import { openalexResolver } from "../../../../src/import/pdfFinder/openAccess";
import { json, makeContext, makeFindingHarness } from "../../../support/pdfFindingHarness";

const LOOKUP = "https://api.openalex.org/works/doi:10.1%2Fx?select=id,doi,title,publication_year,authorships,ids,open_access,best_oa_location,locations&mailto=me%40uni.edu";
const work = {
  title: "Deep residual learning for image recognition",
  publication_year: 2016,
  ids: { pmcid: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5586528" },
  open_access: { oa_url: "https://oa.example/oa.pdf" },
  best_oa_location: { pdf_url: "https://pub.example/p.pdf", is_oa: true, source: { type: "journal" } },
  locations: [
    { pdf_url: "https://repo.example/r.pdf", is_oa: true, source: { type: "repository" } },
    { landing_page_url: "https://arxiv.org/abs/hep-th/9711200v2", pdf_url: "https://arxiv.org/pdf/hep-th/9711200v2", is_oa: true, source: { type: "repository" } },
    { landing_page_url: "https://repo.example/handle/1", is_oa: true, source: { type: "repository" } },
    { landing_page_url: "https://closed.example/paper", is_oa: false },
  ],
};

describe("openalexResolver", () => {
  it("learns the PMCID and the old-style arXiv id, and leaves PMC and arXiv copies to their resolvers", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json(work);
    const ctx = makeContext({ doi: "10.1/x" });
    const urls = await openalexResolver.resolve(ctx, h.env);
    expect(ctx).toMatchObject({ pmcid: "PMC5586528", arxivId: "hep-th/9711200" });
    expect(urls).toEqual(["https://pub.example/p.pdf", "https://oa.example/oa.pdf", "https://repo.example/r.pdf", "https://repo.example/handle/1"]);
  });

  it("keeps an identifier the context already has", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json(work);
    const ctx = makeContext({ doi: "10.1/x", pmcid: "PMC1", arxivId: "2301.00001" });
    await openalexResolver.resolve(ctx, h.env);
    expect(ctx).toMatchObject({ pmcid: "PMC1", arxivId: "2301.00001" });
  });

  it("accepts a record whose title is the same work", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json(work);
    const ctx = makeContext({ doi: "10.1/x", title: "Deep Residual Learning for Image Recognition", year: 2015 });
    expect(await openalexResolver.resolve(ctx, h.env)).toContain("https://pub.example/p.pdf");
  });

  it("drops the whole record, ids included, when its title is another paper's", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json(work);
    const ctx = makeContext({ doi: "10.1/x", title: "A thesis about something else entirely" });
    expect(await openalexResolver.resolve(ctx, h.env)).toEqual([]);
    expect(ctx.pmcid).toBeUndefined();
    expect(h.logs).toEqual([expect.objectContaining({ level: "WARN", context: expect.objectContaining({ source: "openalex" }) })]);
  });

  it("drops a record without a title when the context has one", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json({ ...work, title: null });
    expect(await openalexResolver.resolve(makeContext({ doi: "10.1/x", title: "Deep residual learning" }), h.env)).toEqual([]);
  });

  it("needs a DOI", async () => {
    const h = makeFindingHarness();
    expect(await openalexResolver.resolve(makeContext({ pmid: "123" }), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("notes each location's version label for its PDF and landing URLs, keeping the first label", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json({
      title: work.title,
      best_oa_location: { pdf_url: "https://pub.example/p.pdf", is_oa: true, version: "publishedVersion" },
      locations: [
        { pdf_url: "https://pub.example/p.pdf", is_oa: true, version: "submittedVersion" },
        { pdf_url: "https://repo.example/r.pdf", landing_page_url: "https://repo.example/handle/1", is_oa: true, version: "acceptedVersion" },
        { pdf_url: "https://pre.example/p.pdf", is_oa: true, version: "submittedVersion" },
        { pdf_url: "https://odd.example/p.pdf", is_oa: true, version: "other" },
      ],
    });
    const ctx = makeContext({ doi: "10.1/x" });
    await openalexResolver.resolve(ctx, h.env);
    expect(Object.fromEntries(ctx.versions!)).toEqual({
      "https://pub.example/p.pdf": "published",
      "https://repo.example/r.pdf": "accepted",
      "https://repo.example/handle/1": "accepted",
      "https://pre.example/p.pdf": "preprint",
    });
  });

  it("keeps no pre-publication label on a copy from a journal source", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json({
      title: work.title,
      locations: [
        { pdf_url: "https://journals.plos.org/p.pdf", is_oa: true, version: "submittedVersion", source: { type: "journal" } },
        { pdf_url: "https://repo.example/r.pdf", is_oa: true, version: "submittedVersion", source: { type: "repository" } },
      ],
    });
    const ctx = makeContext({ doi: "10.1/x" });
    await openalexResolver.resolve(ctx, h.env);
    expect(Object.fromEntries(ctx.versions!)).toEqual({ "https://repo.example/r.pdf": "preprint" });
  });

  it("notes no version from a record it rejects", async () => {
    const h = makeFindingHarness();
    h.routes[LOOKUP] = () => json({ ...work, best_oa_location: { ...work.best_oa_location, version: "publishedVersion" } });
    const ctx = makeContext({ doi: "10.1/x", title: "A thesis about something else entirely" });
    await openalexResolver.resolve(ctx, h.env);
    expect(ctx.versions).toBeUndefined();
  });
});
