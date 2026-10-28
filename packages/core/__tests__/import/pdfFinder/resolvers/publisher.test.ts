/** Contract of the publisher resolver: the rule table's PDF URLs for the landing page, then for the DOI. */
import { publisherResolver } from "../../../../src/import/pdfFinder/openAccess";
import { makeContext, makeFindingHarness } from "../../../support/pdfFindingHarness";

const { env } = makeFindingHarness();
const ctx = makeContext();

describe("publisherResolver", () => {
  it("returns nothing without a DOI or a landing page", async () => {
    await expect(publisherResolver.resolve(ctx, env)).resolves.toEqual([]);
    await expect(publisherResolver.resolve({ ...ctx, doi: "10.1145/1.2" }, env)).resolves.toEqual(["https://dl.acm.org/doi/pdf/10.1145/1.2"]);
  });

  it("puts the landing-page link before DOI templates", async () => {
    const urls = await publisherResolver.resolve({ ...ctx, doi: "10.1145/1.2", landingUrl: "https://ieeexplore.ieee.org/document/42" }, env);
    expect(urls).toEqual(["https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=42", "https://dl.acm.org/doi/pdf/10.1145/1.2"]);
  });
});
