import type { PageFacts, PaperRecord, ResolvedMetadata } from "@labshelf/core";
import { resolvePagePaper } from "@labshelf/core";
import { doiOf } from "../../support/doi";

import { makeFindingHarness } from "../../support/pdfFindingHarness";

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  pageUrl: "https://pub.example/a", ids: {}, metadata: { title: "A long enough page title here" },
  structured: true, pdfCandidates: [], isPaper: true, ...over,
});
const record = (over: Partial<PaperRecord>): PaperRecord => ({ id: "have", title: "Other", citeKey: "have", path: "papers/have", status: "unread", ...over });
const REGISTRY: ResolvedMetadata = { title: "Registry Title Of The Paper", authors: ["Ann Lee"], year: 2020, doi: "10.1234/x" };

describe("resolvePagePaper", () => {
  it("does not look up a page that names no paper and brings no other source, nor read the library", async () => {
    const resolveIdentifier = jest.fn(async () => REGISTRY);
    const searchByTitle = jest.fn(async () => REGISTRY);
    const records = jest.fn(() => [record({ title: "A long enough page title here" })]);

    const paper = await resolvePagePaper(facts({ isPaper: false }), records, { deps: { resolveIdentifier, searchByTitle } });

    expect(paper).toEqual({ metadata: { title: "A long enough page title here" }, ids: {}, origin: "none", isPaper: false });
    expect(searchByTitle).not.toHaveBeenCalled();
    expect(records).not.toHaveBeenCalled();
  });

  it("counts a page the registry recognised from another source as a paper", async () => {
    const searchByTitle = jest.fn(async () => REGISTRY);
    const extraSources = [{ name: "scholar", trust: 20, metadata: { title: "Registry Title Of The Paper", year: 2020 } }];

    const paper = await resolvePagePaper(facts({ isPaper: false, metadata: {} }), () => [], { extraSources, deps: { searchByTitle } });

    expect(paper).toMatchObject({ isPaper: true, origin: "search", ids: { doi: "10.1234/x" }, metadata: { title: "Registry Title Of The Paper" } });
  });

  it("finds the library's copy by the DOI the registry revealed", async () => {
    const resolveIdentifier = jest.fn(async () => REGISTRY);
    const have = record({ doi: "10.1234/X" });

    const paper = await resolvePagePaper(facts({ ids: { doi: doiOf("10.1234/x") } }), async () => [have], { deps: { resolveIdentifier } });

    expect(paper).toMatchObject({ origin: "registry", isPaper: true, existing: have });
  });

  it("runs the default lookups on the given registry network and logs their failures there", async () => {
    const net = makeFindingHarness();

    const paper = await resolvePagePaper(facts({ ids: { doi: doiOf("10.1234/x") } }), () => [], { deps: { registry: { fetch: net.opts().fetch!, logger: net.logger } } });

    expect(paper.origin).toBe("page");
    expect(net.calls.some((url) => url.startsWith("https://api.crossref.org/works/"))).toBe(true);
    expect(net.logs.find((l) => l.message === "Registry lookup failed")).toMatchObject({ level: "WARN", module: "registries" });
  });
});
