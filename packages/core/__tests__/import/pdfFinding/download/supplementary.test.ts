/** Which links count as supplementary material rather than the article. */
import { isSupplementaryUrl } from "../../../../src/import/pdfFinding/download/index";

describe("isSupplementaryUrl", () => {
  it.each([
    "https://static-content.springer.com/esm/art%3A10.1038%2Fnature12373/MediaObjects/41586_2013_BFnature12373_MOESM63_ESM.pdf",
    "https://pubs.acs.org/doi/suppl/10.1021/jacs.0c01234/suppl_file/ja0c01234_si_001.pdf",
    "https://onlinelibrary.wiley.com/action/downloadSupplement?doi=10.1002%2Fanie.2020&file=anie-s1.pdf",
    "https://www.example.org/content/Supplementary_Materials.pdf",
  ])("flags %s", (url) => expect(isSupplementaryUrl(url)).toBe(true));

  it.each([
    "https://www.nature.com/articles/nature12373.pdf",
    "https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf",
    "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000308&type=printable",
    "https://arxiv.org/pdf/1706.03762",
  ])("keeps %s", (url) => expect(isSupplementaryUrl(url)).toBe(false));
});
