/** Contract of the title-only twin search: arXiv by title and surname, then OpenAlex's free autocomplete, each hit checked against the title. */
import { titleTwinResolver } from "../../../../src/import/pdfFinder/matching";
import { json, makeContext, makeFindingHarness } from "../../../support/pdfFindingHarness";

const TITLE = "Attention Is All You Need";
const ARXIV = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${TITLE}"`)}+AND+au:vaswani&max_results=3`;
const ARXIV_NO_AUTHOR = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${TITLE}"`)}&max_results=3`;
const AUTOCOMPLETE = `https://api.openalex.org/autocomplete/works?q=${encodeURIComponent(TITLE)}`;
const BY_ID = "https://api.openalex.org/works/W2626778328?select=id,doi,title,publication_year,authorships,ids,open_access,best_oa_location,locations&mailto=me%40uni.edu";

const feed = (title: string, id: string, author = "Ashish Vaswani"): Response =>
  new Response(`<feed><entry><id>http://arxiv.org/abs/${id}</id><published>2017-06-12T00:00:00Z</published><title>${title}</title>`
    + `<author><name>${author}</name></author></entry></feed>`);
const ctxFor = (over = {}) => makeContext({ title: TITLE, authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, ...over });
const hit = (title: string, hint: string) => ({ results: [{ id: "https://openalex.org/W2626778328", display_name: title, hint }] });
const record = { title: TITLE, publication_year: 2017, authorships: [{ author: { display_name: "Ashish Vaswani" } }],
  best_oa_location: { pdf_url: "https://pub.example/attention.pdf", is_oa: true, source: { type: "journal" } } };

describe("titleTwinResolver", () => {
  it("makes no call without a title", async () => {
    const h = makeFindingHarness();
    expect(await titleTwinResolver.resolve(makeContext({ authors: ["Ashish Vaswani"] }), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it.each([{ doi: "10.1/x" }, { arxivId: "1706.03762" }])("makes no call when the paper has %o", async (ids) => {
    const h = makeFindingHarness();
    expect(await titleTwinResolver.resolve(ctxFor(ids), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("learns the old-style arXiv id of a hit that is the same work", async () => {
    const h = makeFindingHarness();
    h.routes[ARXIV] = () => feed(TITLE, "hep-th/9711200v3");
    const ctx = ctxFor();
    expect(await titleTwinResolver.resolve(ctx, h.env)).toEqual([]);
    expect(ctx.arxivId).toBe("hep-th/9711200");
    expect(h.calls).toEqual([ARXIV]);
  });

  it("searches by title alone when the paper has no authors", async () => {
    const h = makeFindingHarness();
    h.routes[ARXIV_NO_AUTHOR] = () => feed(TITLE, "1706.03762v7");
    const ctx = ctxFor({ authors: undefined });
    await titleTwinResolver.resolve(ctx, h.env);
    expect(ctx.arxivId).toBe("1706.03762");
  });

  it("ignores an arXiv hit with another title and falls through to OpenAlex", async () => {
    const h = makeFindingHarness();
    h.routes[ARXIV] = () => feed("Attention Is Not All You Need", "2103.03404");
    const ctx = ctxFor();
    await titleTwinResolver.resolve(ctx, h.env);
    expect(ctx.arxivId).toBeUndefined();
    expect(h.calls).toEqual([ARXIV, AUTOCOMPLETE]);
  });

  it("takes the copies of OpenAlex's record when arXiv has no match", async () => {
    const h = makeFindingHarness();
    h.routes[AUTOCOMPLETE] = () => json(hit(TITLE, "Ashish Vaswani, Noam Shazeer, et al."));
    h.routes[BY_ID] = () => json(record);
    expect(await titleTwinResolver.resolve(ctxFor(), h.env)).toEqual(["https://pub.example/attention.pdf"]);
    expect(h.calls).toEqual([ARXIV, AUTOCOMPLETE, BY_ID]);
  });

  it("learns an arXiv id from the locations of OpenAlex's record", async () => {
    const h = makeFindingHarness();
    h.routes[AUTOCOMPLETE] = () => json(hit(TITLE, "Ashish Vaswani"));
    h.routes[BY_ID] = () => json({ ...record, locations: [{ landing_page_url: "https://arxiv.org/abs/1706.03762v7", pdf_url: "https://arxiv.org/pdf/1706.03762v7" }] });
    const ctx = ctxFor();
    await titleTwinResolver.resolve(ctx, h.env);
    expect(ctx.arxivId).toBe("1706.03762");
  });

  it("does not fetch the record of an autocomplete hit with another title", async () => {
    const h = makeFindingHarness();
    h.routes[AUTOCOMPLETE] = () => json(hit("Attention in Neural Machine Translation", "Ashish Vaswani"));
    expect(await titleTwinResolver.resolve(ctxFor(), h.env)).toEqual([]);
    expect(h.calls).toEqual([ARXIV, AUTOCOMPLETE]);
  });

  it("does not fetch the record of an autocomplete hit by other authors", async () => {
    const h = makeFindingHarness();
    h.routes[AUTOCOMPLETE] = () => json(hit(TITLE, "J. M. Bishop, Gabriel Seiberth"));
    expect(await titleTwinResolver.resolve(ctxFor(), h.env)).toEqual([]);
    expect(h.calls).not.toContain(BY_ID);
  });

  it("drops OpenAlex's record when its full data is another paper's", async () => {
    const h = makeFindingHarness();
    h.routes[AUTOCOMPLETE] = () => json(hit(TITLE, "Ashish Vaswani"));
    h.routes[BY_ID] = () => json({ ...record, publication_year: 2025 });
    expect(await titleTwinResolver.resolve(ctxFor(), h.env)).toEqual([]);
  });
});
