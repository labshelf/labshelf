import type { DetectedIdentifier, ResolvedMetadata } from "@labshelf/core";
import { PAGE_TRUST, resolveMetadata, withAbstract } from "@labshelf/core";
import { checkTitleAgreement } from "../../../src/import/samePaper";
import { doiOf } from "../../support/doi";
import { makeFindingHarness } from "../../support/pdfFindingHarness";

const resolveIdentifier = jest.fn<Promise<ResolvedMetadata | undefined>, [DetectedIdentifier]>();
const searchByTitle = jest.fn<Promise<ResolvedMetadata | undefined>, [string]>();
const deps = { resolveIdentifier, searchByTitle };

const page = (metadata: ResolvedMetadata, trust: number = PAGE_TRUST.structured) => ({ name: "page", trust, metadata });

beforeEach(() => {
  resolveIdentifier.mockReset();
  searchByTitle.mockReset();
});

describe("resolveMetadata", () => {
  it("lets the registry win each field it has and keeps what only the page states", async () => {
    resolveIdentifier.mockResolvedValue({ title: "Registry Title", authors: ["Oscar H. Ibarra"], year: 1982, journal: "Journal of Algorithms", volume: "3" });
    const r = await resolveMetadata({
      ids: { doi: doiOf("10.1016/0196-6774(82)90007-4") },
      sources: [page({ title: "Page title", journal: "J. Algorithms", issue: "1", pages: "45-56" })],
    }, deps);
    expect(r.origin).toBe("registry");
    expect(r.metadata).toMatchObject({ title: "Registry Title", journal: "Journal of Algorithms", volume: "3", issue: "1", pages: "45-56" });
    expect(resolveIdentifier).toHaveBeenCalledWith({ type: "doi", value: "10.1016/0196-6774(82)90007-4" });
  });

  it("finds the DOI by title when the page has none, if year and authors agree", async () => {
    searchByTitle.mockResolvedValue({ title: "A generalization of the fast LUP", authors: ["O. H. Ibarra", "S. Moran"], year: 1982, doi: "10.1016/x" });
    const r = await resolveMetadata({ ids: {}, sources: [page({ title: "A generalization of the fast LUP", authors: ["OH Ibarra"], year: 1982 }, 20)] }, deps);
    expect(r.origin).toBe("search");
    expect(r.ids.doi).toBe("10.1016/x");
  });

  it("rejects a title match from another year", async () => {
    searchByTitle.mockResolvedValue({ title: "Same title", year: 2010, doi: "10.1/wrong" });
    const r = await resolveMetadata({ ids: {}, sources: [page({ title: "Same title", year: 1982 })] }, deps);
    expect(r.origin).toBe("page");
    expect(r.ids.doi).toBeUndefined();
  });

  it("asks arXiv, not the registry, for an arXiv DOI", async () => {
    resolveIdentifier.mockResolvedValue({ title: "Attention Is All You Need" });
    await resolveMetadata({ ids: { doi: doiOf("10.48550/arXiv.1706.03762"), arxivId: "1706.03762" }, sources: [] }, deps);
    expect(resolveIdentifier).toHaveBeenCalledWith({ type: "arxiv", value: "1706.03762" });
  });
});

describe("agrees", () => {
  it("compares surnames, ignoring initials, and tolerates a year apart", () => {
    expect(checkTitleAgreement({ authors: ["Peter W. Shor"], year: 1986 }, { authors: ["P Shor…"], year: 1987 })).toBe(true);
    expect(checkTitleAgreement({ authors: ["Someone Else"] }, { authors: ["P Shor"] })).toBe(false);
    expect(checkTitleAgreement({ year: 2010 }, { year: 1982 })).toBe(false);
  });
});

describe("withAbstract", () => {
  const enrich = jest.fn();

  it("fills a missing abstract from the registry that has one", async () => {
    enrich.mockResolvedValue([{ name: "semanticscholar", trust: 90, metadata: { summary: "An abstract." } }]);
    expect(await withAbstract({ title: "T", doi: "10.1/x" }, { enrich })).toMatchObject({ summary: "An abstract." });
    expect(enrich).toHaveBeenCalledWith("10.1/x");
  });

  it("keeps the record when it has an abstract, has no DOI, or the lookup fails", async () => {
    enrich.mockClear();
    const withSummary = { title: "T", doi: "10.1/x", summary: "Mine." };
    expect(await withAbstract(withSummary, { enrich })).toBe(withSummary);
    expect(await withAbstract({ title: "T" }, { enrich })).toEqual({ title: "T" });
    expect(enrich).not.toHaveBeenCalled();
    enrich.mockRejectedValue(new Error("down"));
    expect(await withAbstract({ title: "T", doi: "10.1/x" }, { enrich })).toEqual({ title: "T", doi: "10.1/x" });
  });

  it("asks the abstract registries on the given network and logs their failures there", async () => {
    const net = makeFindingHarness();
    expect(await withAbstract({ title: "T", doi: "10.1/x" }, { registry: { fetch: net.opts().fetch!, logger: net.logger } })).toEqual({ title: "T", doi: "10.1/x" });
    expect(net.calls.length).toBeGreaterThan(0);
    expect(net.logs.some((l) => l.module === "registries" && l.level === "WARN")).toBe(true);
  });
});
