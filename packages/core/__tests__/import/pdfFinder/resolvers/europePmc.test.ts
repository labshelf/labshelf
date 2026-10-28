/** Contract of the Europe PMC learner: the PMCID and non-Europe-PMC PDF links, only from the record with the searched DOI. */
import { europePmcResolver } from "../../../../src/import/pdfFinder/openAccess";
import { json, makeContext, makeFindingHarness } from "../../../support/pdfFindingHarness";

const search = (query: string): string =>
  `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=3`;
const hit = {
  doi: "10.1/X",
  title: "Open access in biology",
  pubYear: "2020",
  pmcid: "pmc5586528",
  inPMC: "Y",
  fullTextUrlList: { fullTextUrl: [
    { documentStyle: "pdf", site: "Europe_PMC", url: "https://europepmc.org/render.pdf" },
    { documentStyle: "pdf", site: "Unpaywall", url: "https://repo.example/oa.pdf" },
    { documentStyle: "html", site: "DOI", url: "https://doi.org/10.1/x" },
  ] },
};

describe("europePmcResolver", () => {
  it("learns the PMCID and returns the PDF links that are not Europe PMC's own", async () => {
    const h = makeFindingHarness();
    h.routes[search('DOI:"10.1/x"')] = () => json({ resultList: { result: [hit] } });
    const ctx = makeContext({ doi: "10.1/x" });
    expect(await europePmcResolver.resolve(ctx, h.env)).toEqual(["https://repo.example/oa.pdf"]);
    expect(ctx.pmcid).toBe("PMC5586528");
  });

  it("rejects results whose DOI is not the one searched, and says so", async () => {
    const h = makeFindingHarness();
    h.routes[search('DOI:"10.1/x"')] = () => json({ resultList: { result: [{ ...hit, doi: "10.9/other" }] } });
    const ctx = makeContext({ doi: "10.1/x" });
    expect(await europePmcResolver.resolve(ctx, h.env)).toEqual([]);
    expect(ctx.pmcid).toBeUndefined();
    expect(h.logs).toHaveLength(1);
  });

  it("rejects a record whose title is another paper's", async () => {
    const h = makeFindingHarness();
    h.routes[search('DOI:"10.1/x"')] = () => json({ resultList: { result: [hit] } });
    const ctx = makeContext({ doi: "10.1/x", title: "XGBoost: a scalable tree boosting system" });
    expect(await europePmcResolver.resolve(ctx, h.env)).toEqual([]);
    expect(ctx.pmcid).toBeUndefined();
  });

  it("searches by PMCID, then by PMID, without a DOI", async () => {
    const h = makeFindingHarness();
    await europePmcResolver.resolve(makeContext({ pmcid: "pmc123" }), h.env);
    await europePmcResolver.resolve(makeContext({ pmid: "999" }), h.env);
    expect(h.calls).toEqual([search("PMCID:PMC123"), search("EXT_ID:999 AND SRC:MED")]);
  });
});
