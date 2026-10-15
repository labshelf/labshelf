/** Contract of next-hop reading: an HTML answer on a known platform's landing page leads to the rule's PDF URL. */
import { nextHopsFromHtml } from "../../../../src/import/pdfFinding/download/nextHops";

describe("nextHopsFromHtml", () => {
  it("follows the publisher rule for a landing page a hop reaches", () => {
    expect(nextHopsFromHtml("<html><body>Abstract</body></html>", "https://ieeexplore.ieee.org/document/726791")).toEqual([
      "https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=726791",
    ]);
  });

  it("skips the supplements a paywalled article page links", () => {
    const supplement = "https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fnature14236/MediaObjects/41586_2015_BFnature14236_MOESM122_ESM.pdf";
    const page = `<html><head><meta name="citation_pdf_url" content="${supplement}"></head><body>Abstract</body></html>`;
    expect(nextHopsFromHtml(page, "https://example.org/paper")).toEqual([]);
  });

  it("proposes nothing for a page outside the table that offers no link", () => {
    expect(nextHopsFromHtml("<html><body>Abstract</body></html>", "https://example.org/paper")).toEqual([]);
  });
});
