/** Contract of the Sci-Hub resolver: silent until the user configures a mirror, then a soft-miss reader of the mirror's page. */
import { sciHubResolver } from "../../../../../src/io/pdfFinding/resolvers/index";
import { html, makeContext, makeFindingHarness, pdf } from "../../../../support/pdfFindingHarness";

const MIRROR = "https://mirror.example";

describe("sciHubResolver", () => {
  it("never contacts the mirror without the opt-in", async () => {
    const h = makeFindingHarness();
    expect(await sciHubResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("reads the embedded PDF address off the mirror's page and makes it absolute", async () => {
    const h = makeFindingHarness();
    h.routes[`${MIRROR}/10.1/x`] = () => html('<embed type="application/pdf" src="//cdn.mirror.example/files/x.pdf#navpanes=0">');
    expect(await sciHubResolver.resolve(makeContext({ doi: "10.1/x", sciHubMirror: `${MIRROR}/` }), h.env)).toEqual([
      "https://cdn.mirror.example/files/x.pdf#navpanes=0",
    ]);
  });

  it("returns the mirror's own URL when it serves the PDF directly", async () => {
    const h = makeFindingHarness();
    h.routes[`${MIRROR}/10.1/x`] = () => new Response(pdf().body, { headers: { "content-type": "application/pdf" } });
    expect(await sciHubResolver.resolve(makeContext({ doi: "10.1/x", sciHubMirror: MIRROR }), h.env)).toEqual([`${MIRROR}/10.1/x`]);
  });

  it("finds nothing on a page without a PDF", async () => {
    const h = makeFindingHarness();
    h.routes[`${MIRROR}/10.1/x`] = () => html("<p>article not found</p>");
    expect(await sciHubResolver.resolve(makeContext({ doi: "10.1/x", sciHubMirror: MIRROR }), h.env)).toEqual([]);
  });
});
