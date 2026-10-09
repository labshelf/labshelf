/** Contract of the Semantic Scholar learner: externalIds for the resolvers that follow, its open-access link, a literal slash in the DOI. */
import { semanticScholarResolver } from "../../../../../src/io/pdfFinding/resolvers/index";
import { json, makeContext, makeFindingHarness } from "../../../../support/pdfFindingHarness";

const FIELDS = "title,year,authors,externalIds,openAccessPdf";
const paper = {
  title: "Attention is all you need",
  year: 2017,
  authors: [{ name: "Ashish Vaswani" }],
  externalIds: { ArXiv: "1706.03762v5", ACL: "n19-1423", PubMedCentral: "5586528" },
  openAccessPdf: { url: "https://oa.example/attention.pdf", status: "GREEN" },
};

describe("semanticScholarResolver", () => {
  it("asks with the DOI's slash left literal, because an encoded one is rate-limited", async () => {
    const h = makeFindingHarness();
    h.routes[`https://api.semanticscholar.org/graph/v1/paper/DOI:10.1145/3295222?fields=${FIELDS}`] = () => json(paper);
    expect(await semanticScholarResolver.resolve(makeContext({ doi: "10.1145/3295222" }), h.env)).toHaveLength(2);
    expect(h.calls[0]).not.toContain("%2F");
  });

  it("learns the arXiv id and PMCID, and returns the ACL and open-access copies", async () => {
    const h = makeFindingHarness();
    h.routes[`https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x?fields=${FIELDS}`] = () => json(paper);
    const ctx = makeContext({ doi: "10.1/x" });
    expect(await semanticScholarResolver.resolve(ctx, h.env)).toEqual(["https://aclanthology.org/N19-1423.pdf", "https://oa.example/attention.pdf"]);
    expect(ctx).toMatchObject({ arxivId: "1706.03762", pmcid: "PMC5586528" });
  });

  it("falls back to the arXiv id, then the PMID, when there is no DOI", async () => {
    const h = makeFindingHarness();
    await semanticScholarResolver.resolve(makeContext({ arxivId: "hep-th/9711200" }), h.env);
    await semanticScholarResolver.resolve(makeContext({ pmid: "123456" }), h.env);
    expect(h.calls).toEqual([
      `https://api.semanticscholar.org/graph/v1/paper/ARXIV:hep-th/9711200?fields=${FIELDS}`,
      `https://api.semanticscholar.org/graph/v1/paper/PMID:123456?fields=${FIELDS}`,
    ]);
  });

  it("ignores a closed or arXiv open-access link", async () => {
    const h = makeFindingHarness();
    h.routes[`https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x?fields=${FIELDS}`] = () =>
      json({ ...paper, externalIds: {}, openAccessPdf: { url: "https://arxiv.org/pdf/1706.03762", status: "GREEN" } });
    expect(await semanticScholarResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([]);
  });

  it("ignores a record that is another paper, ids included", async () => {
    const h = makeFindingHarness();
    h.routes[`https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x?fields=${FIELDS}`] = () => json(paper);
    const ctx = makeContext({ doi: "10.1/x", title: "Some unrelated clinical trial of aspirin" });
    expect(await semanticScholarResolver.resolve(ctx, h.env)).toEqual([]);
    expect(ctx.arxivId).toBeUndefined();
  });

  it("needs an identifier, and warns once about a rate limit", async () => {
    const h = makeFindingHarness();
    expect(await semanticScholarResolver.resolve(makeContext({ title: "Only a title" }), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
    h.routes[`https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x?fields=${FIELDS}`] = () => new Response("", { status: 429 });
    await semanticScholarResolver.resolve(makeContext({ doi: "10.1/x" }), h.env);
    expect(h.logs).toEqual([expect.objectContaining({ level: "WARN", context: expect.objectContaining({ status: 429 }) })]);
  });
});
