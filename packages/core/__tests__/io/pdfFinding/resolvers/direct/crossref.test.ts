/** Contract of the CrossRef resolver: PDF links the publisher registered, best intent first. */
import { crossrefResolver } from "../../../../../src/io/pdfFinding/resolvers/index";
import { json, makeContext, makeFindingHarness } from "../../../../support/pdfFindingHarness";

const URL_FOR = "https://api.crossref.org/works/10.1%2Fx";

describe("crossrefResolver", () => {
  it("returns typed PDF links by intent, then bare .pdf links, and ignores the rest", async () => {
    const h = makeFindingHarness();
    h.routes[URL_FOR] = () => json({ message: { link: [
      { URL: "https://p.example/html", "content-type": "text/html" },
      { URL: "https://p.example/plain.pdf", "content-type": "unspecified" },
      { URL: "https://p.example/syndication", "content-type": "application/pdf", "intended-application": "syndication" },
      { URL: "https://p.example/mining", "content-type": "application/pdf", "intended-application": "text-mining" },
    ] } });
    expect(await crossrefResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([
      "https://p.example/mining", "https://p.example/syndication", "https://p.example/plain.pdf",
    ]);
  });

  it("identifies LabShelf with the contact email", async () => {
    const seen: unknown[] = [];
    const h = makeFindingHarness();
    const env = { ...h.env, fetch: (async (_u: unknown, init: unknown) => { seen.push(init); return json({}); }) as typeof fetch };
    await crossrefResolver.resolve(makeContext({ doi: "10.1/x" }), env);
    expect(seen[0]).toMatchObject({ headers: { "User-Agent": "LabShelf/0.1 (mailto:me@uni.edu)" } });
  });

  it("logs one warning with the status when CrossRef refuses", async () => {
    const h = makeFindingHarness();
    h.routes[URL_FOR] = () => new Response("", { status: 500 });
    expect(await crossrefResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([]);
    expect(h.logs).toEqual([expect.objectContaining({ level: "WARN", context: { url: URL_FOR, status: 500 } })]);
  });

  it("does nothing without a DOI", async () => {
    const h = makeFindingHarness();
    expect(await crossrefResolver.resolve(makeContext(), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
  });
});
