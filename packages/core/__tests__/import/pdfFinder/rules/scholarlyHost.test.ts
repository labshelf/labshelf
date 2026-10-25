/** Scholarly-host test: publisher and repository hosts count, reference and encyclopedia pages do not. */
import { isScholarlyHost } from "../../../../src/import/pdfFinder/rules/index";

describe("isScholarlyHost", () => {
  it.each([
    "https://www.sciencedirect.com/science/article/pii/0022283681900875",
    "https://link.springer.com/article/10.1007/s00453-020-00001-1",
    "https://onlinelibrary.wiley.com/doi/10.1002/anie.201000001",
    "https://www.biorxiv.org/content/10.1101/2020.01.01.000001v1",
    "https://www.scielo.br/j/rsp/a/abc/",
  ])("holds for a publisher host in the rule table: %s", (url) => {
    expect(isScholarlyHost(url)).toBe(true);
  });

  it.each([
    "https://pubmed.ncbi.nlm.nih.gov/7265238/",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/",
    "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123456/",
    "https://europepmc.org/article/MED/7265238",
    "https://arxiv.org/abs/1706.03762",
    "https://www.semanticscholar.org/paper/abc",
    "https://openalex.org/W2029240519",
    "https://doi.org/10.1016/0022-2836(81)90087-5",
    "https://dx.doi.org/10.1016/0022-2836(81)90087-5",
  ])("holds for an index or repository host: %s", (url) => {
    expect(isScholarlyHost(url)).toBe(true);
  });

  it.each([
    "https://www.scirp.org/reference/referencespapers?referenceid=123",
    "https://en.wikipedia.org/wiki/Smith%E2%80%93Waterman_algorithm",
    "https://www.ncbi.nlm.nih.gov/gene/7157",
    "https://notdoi.org.example.com/x",
    "ftp://arxiv.org/abs/1706.03762",
    "not a url",
  ])("does not hold for %s", (url) => {
    expect(isScholarlyHost(url)).toBe(false);
  });
});
